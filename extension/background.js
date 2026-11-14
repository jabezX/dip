import { DEV_TEST } from "./core/dev.js";
import { extractPrice, isUnavailable } from "./core/extract.js";
import { describeChange, everyMinutes, failed, isDue, record } from "./core/items.js";
import { answer, suggest } from "./suggest.js";

// The test product exists only in unpacked (development) installs: store
// installs have an update_url. Release packages don't even contain it.
const TEST = "update_url" in chrome.runtime.getManifest() ? null : DEV_TEST;

const load = async () => (await chrome.storage.local.get("items")).items ?? [];
const prefs = async () => (await chrome.storage.local.get("prefs")).prefs ?? {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message, extra) => Object.assign(new Error(message), extra);

// ---------- scheduling ----------

// The alarm wakes at least hourly and checks what is due, so a long interval
// still holds when the browser was closed in between.
async function schedule() {
  const every = everyMinutes((await prefs()).every);
  await chrome.alarms.create("check", { delayInMinutes: 1, periodInMinutes: Math.min(every, 60) });
  await scheduleTest();
}

// while a test product is in the list: a check every minute
async function scheduleTest() {
  const testing = TEST && (await load()).some((i) => i.url === TEST.url);
  if (!testing) return chrome.alarms.clear("test");
  if (!(await chrome.alarms.get("test"))) await chrome.alarms.create("test", { delayInMinutes: 1, periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener((changes) => {
  const every = (c) => JSON.stringify(c?.every ?? null);
  if (changes.prefs && every(changes.prefs.oldValue) !== every(changes.prefs.newValue)) schedule();
  if (changes.items) scheduleTest();
});
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === "test") checkAll({ only: (i) => i.url === TEST?.url });
  else checkAll({ dueOnly: true });
});

// ---------- messages ----------

// A product page finished loading on a shop Dip may read: offer to watch it.
// (tab.url is only filled in for sites the extension has access to.)
const ours = new Set(); // tabs opened by renderedHtml
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || ours.has(tabId) || !/^https?:/.test(tab?.url ?? "")) return;
  suggest(tabId, tab.url).catch(() => {}); // a page we can't script is not an error
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  // the buttons on the suggestion card
  if (message?.type === "suggestion") {
    answer(message);
    return;
  }
  // the popup's refresh button
  if (message === "check") {
    checkAll().then(() => reply(true));
    return true; // keep the channel open for the async reply
  }
  // the web app, through bridge.js
  if (message?.type === "lookup") {
    lookup(message.url).then(
      (found) => reply({ found }),
      (e) => reply({ error: e.message, gone: e.gone, unavailable: e.unavailable }),
    );
    return true;
  }
});

chrome.notifications.onClicked.addListener(async (id) => {
  const item = (await load()).find((i) => i.id === id.split("|")[0]);
  if (item) chrome.tabs.create({ url: item.url });
  chrome.notifications.clear(id);
});

// ---------- looking a price up ----------

async function lookup(url, item) {
  if (TEST && url === TEST.url) return TEST.found(item?.history.at(-1)?.p);
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw fail("Only http(s) links are supported");
  if (!(await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }))) {
    throw fail("No access to this shop");
  }

  let reason = "No price found";
  try {
    // with cookies, so the shop sees the same visitor it sees in a tab
    const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20_000) });
    if (res.status === 404 || res.status === 410) throw fail("Unlisted", { gone: true });
    if (res.ok) {
      const html = await res.text();
      const found = extractPrice(html, res.url || url);
      if (found) return found;
      if (isUnavailable(html)) throw fail("Unavailable", { unavailable: true });
    } else {
      reason = `Shop answered ${res.status}`;
    }
  } catch (e) {
    if (e.gone || e.unavailable) throw e;
    reason = "Shop unreachable";
  }

  // Nothing in the plain HTML. Plenty of shops fill prices in with scripts,
  // so let the page actually run.
  const rendered = await renderedHtml(url).catch(() => "");
  const found = rendered && extractPrice(rendered, url);
  if (found) return found;
  if (rendered && isUnavailable(rendered)) throw fail("Unavailable", { unavailable: true });
  throw fail(reason);
}

// ponytail: a real, inactive tab; it shows in the tab strip for a few
// seconds. Only reached when the plain fetch finds nothing.
async function renderedHtml(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  ours.add(tab.id);
  try {
    await new Promise((resolve) => {
      const done = () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timer);
        resolve();
      };
      const onUpdated = (id, info) => id === tab.id && info.status === "complete" && done();
      const timer = setTimeout(done, 25_000);
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
    await sleep(RENDER_SETTLE_MS); // prices often arrive just after load
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });
    return result;
  } finally {
    ours.delete(tab.id);
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}
const RENDER_SETTLE_MS = globalThis.DIP_TEST ? 0 : 1500;

// ---------- checking the list ----------

let running = false;

// ponytail: one request at a time. Plenty for a personal list; batch per
// host if someone watches hundreds of pages.
async function checkAll({ dueOnly = false, only } = {}) {
  if (running) return;
  running = true;
  try {
    const { every } = await prefs();
    for (const item of await load()) {
      if (only && !only(item)) continue;
      if (dueOnly && !isDue(item, every)) continue;
      const found = await lookup(item.url, item).catch((e) => e);
      // re-read: the popup may have changed the list while we were fetching
      const items = (await load()).map((i) => {
        if (i.id !== item.id) return i;
        if (found instanceof Error) return failed(i, found);
        const { item: next, previous } = record(i, found);
        if (previous != null) notify(next, previous);
        return next;
      });
      await chrome.storage.local.set({ items });
    }
  } finally {
    running = false;
  }
}

function notify(item, previous) {
  const { title, body } = describeChange(item, previous);
  // a fresh id every time: reusing one updates the old notification silently
  chrome.notifications.create(`${item.id}|${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/128.png",
    title,
    message: body,
    priority: 2,
  });
}
