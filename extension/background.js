import { DEV_TEST } from "./core/dev.js";
import { extractPrice, isNotFound, isUnavailable } from "./core/extract.js";
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
    answer(message).then((id) => id && probe(id));
    return;
  }
  // the popup just added a product from the open tab
  if (message?.type === "probe") {
    probe(message.id);
    return;
  }
  // the popup's refresh button
  if (message === "check") {
    checkAll().then(() => reply(true));
    return true; // keep the channel open for the async reply
  }
  // the web app, through bridge.js
  if (message?.type === "lookup") {
    lookup(message.url, { via: message.via }).then(
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

const GONE = () => fail("Unlisted", { gone: true });
const OUT = () => fail("Unavailable", { unavailable: true });

/**
 * Read a product's price. `item.via` says how: "fetch" (the plain HTML) or
 * "render" (the page after its scripts ran). It is settled when the product
 * is added (see probe), so every check reads the same version of the page
 * the user saw: some shops change the price with scripts after loading.
 */
async function lookup(url, item) {
  if (TEST && url === TEST.url) return TEST.found(item?.history.at(-1)?.p);
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw fail("Only http(s) links are supported");
  if (!(await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }))) {
    throw fail("No access to this shop");
  }
  if (item?.via === "render") return fromTab(url);

  let reason = "No price found";
  try {
    // with cookies, so the shop sees the same visitor it sees in a tab
    const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20_000) });
    if (res.status === 404 || res.status === 410) throw GONE();
    if (res.ok) {
      const html = await res.text();
      const found = extractPrice(html, res.url || url);
      if (found) return { ...found, via: "fetch" };
      if (isNotFound(html)) throw GONE();
      if (isUnavailable(html)) throw OUT();
    } else {
      reason = `Shop answered ${res.status}`;
    }
  } catch (e) {
    if (e.gone || e.unavailable) throw e;
    if (!/^Shop answered/.test(reason)) reason = "Shop unreachable";
  }
  // a product read from the plain page stays that way: the rendered page may
  // show a different offer, and that would look like a price change
  if (item?.via === "fetch") throw fail(reason);
  // Nothing in the plain HTML. Plenty of shops fill prices in with scripts,
  // so let the page actually run.
  return fromTab(url, reason);
}

async function fromTab(url, reason = "No price found") {
  const html = await renderedHtml(url).catch(() => "");
  const found = html && extractPrice(html, url);
  if (found) return { ...found, via: "render" };
  if (html && isNotFound(html)) throw GONE();
  if (html && isUnavailable(html)) throw OUT();
  // keep what the plain fetch learned ("Shop answered 503") over a vaguer reason
  throw fail(!html && reason === "No price found" ? "Shop unreachable" : reason);
}

/**
 * Added from an open tab, i.e. from the rendered page. If the plain HTML says
 * the same, checks can use the cheap fetch; otherwise they render the page.
 */
async function probe(id) {
  const item = (await load()).find((i) => i.id === id);
  if (!item || item.via || (TEST && item.url === TEST.url)) return;
  let via = "render";
  try {
    const res = await fetch(item.url, { credentials: "include", signal: AbortSignal.timeout(20_000) });
    const found = res.ok && extractPrice(await res.text(), res.url || item.url);
    if (found && found.price === item.history.at(-1).p) via = "fetch";
  } catch {
    // unreachable without scripts: render it
  }
  await chrome.storage.local.set({ items: (await load()).map((i) => (i.id === id ? { ...i, via } : i)) });
}

// ponytail: a real page in a minimized window, for a few seconds. Only
// for shops whose price needs the page's scripts.
async function renderedHtml(url) {
  const win = await chrome.windows.create({ url, focused: false, state: "minimized" });
  const tab = win.tabs[0];
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
    chrome.windows.remove(win.id).catch(() => {});
  }
}
const RENDER_SETTLE_MS = globalThis.DIP_TEST ? 0 : 1500;

// ---------- checking the list ----------

// Checks run one after another: a refresh pressed during the hourly check
// waits its turn instead of being dropped.
let queue = Promise.resolve();
function checkAll(options) {
  const run = queue.then(() => checkNow(options));
  queue = run.catch(() => {});
  return run;
}

// ponytail: one request at a time. Plenty for a personal list; batch per
// host if someone watches hundreds of pages.
async function checkNow({ dueOnly = false, only } = {}) {
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
