import { extractPrice } from "./core/extract.js";
import { describeChange, record, TEST_URL, testFound } from "./core/items.js";
import { answer, suggest } from "./suggest.js";

const PERIOD_MINUTES = 60;

const schedule = () => chrome.alarms.create("check", { delayInMinutes: 1, periodInMinutes: PERIOD_MINUTES });
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(() => checkAll());

// A product page finished loading on a shop Dip may read: offer to watch it.
// (tab.url is only filled in for sites the extension has access to.)
const ours = new Set(); // tabs opened by renderedLookup
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
  // the popup's Refresh button
  if (message === "check") {
    checkAll().then(() => reply(true));
    return true; // keep the channel open for the async reply
  }
  // the web app, through bridge.js
  if (message?.type === "lookup") {
    lookup(message.url).then(
      (found) => reply({ found }),
      (e) => reply({ error: e.message }),
    );
    return true;
  }
});

chrome.notifications.onClicked.addListener(async (id) => {
  const item = (await load()).find((i) => i.id === id);
  if (item) chrome.tabs.create({ url: item.url });
  chrome.notifications.clear(id);
});

const load = async () => (await chrome.storage.local.get("items")).items ?? [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function lookup(url) {
  if (url === TEST_URL) return testFound();
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("Only http(s) links are supported");
  if (!(await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }))) {
    throw new Error("Dip isn't allowed to read this shop yet. Open the Dip extension and allow it.");
  }

  let reason = "No price found on that page";
  try {
    // with cookies, so the shop sees the same visitor it sees in a tab
    const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20_000) });
    if (res.ok) {
      const found = extractPrice(await res.text());
      if (found) return found;
    } else {
      reason = `The shop answered with ${res.status}`;
    }
  } catch {
    reason = "Could not reach the shop";
  }

  // Nothing in the plain HTML. Plenty of shops fill prices in with scripts,
  // so let the page actually run.
  const found = await renderedLookup(url).catch(() => null);
  if (!found) throw new Error(reason);
  return found;
}

// ponytail: a real, inactive tab; it shows in the tab strip for a few
// seconds. Only reached when the plain fetch finds nothing.
async function renderedLookup(url) {
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
    return extractPrice(result);
  } finally {
    ours.delete(tab.id);
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}
const RENDER_SETTLE_MS = globalThis.DIP_TEST ? 0 : 1500;

let running = false;

// ponytail: one request at a time. Plenty for a personal list; batch per
// host if someone watches hundreds of pages.
async function checkAll() {
  if (running) return;
  running = true;
  try {
    for (const { id, url } of await load()) {
      const found = await lookup(url).catch((e) => e);
      // re-read: the popup may have changed the list while we were fetching
      const items = (await load()).map((i) => {
        if (i.id !== id) return i;
        if (found instanceof Error) return { ...i, error: found.message, checkedAt: Date.now() };
        const { item, previous } = record(i, found);
        if (previous != null) {
          const { title, body } = describeChange(item, previous);
          chrome.notifications.create(item.id, { type: "basic", iconUrl: "icons/128.png", title, message: body });
        }
        return item;
      });
      await chrome.storage.local.set({ items });
    }
  } finally {
    running = false;
  }
}
