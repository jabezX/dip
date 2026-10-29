import { extractPrice } from "./core/extract.js";
import { describeChange, record } from "./core/items.js";

const PERIOD_MINUTES = 60;

const schedule = () => chrome.alarms.create("check", { delayInMinutes: 1, periodInMinutes: PERIOD_MINUTES });
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(() => checkAll());

// the popup's Refresh button
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message !== "check") return;
  checkAll().then(() => reply(true));
  return true; // keep the channel open for the async reply
});

chrome.notifications.onClicked.addListener(async (id) => {
  const item = (await load()).find((i) => i.id === id);
  if (item) chrome.tabs.create({ url: item.url });
  chrome.notifications.clear(id);
});

const load = async () => (await chrome.storage.local.get("items")).items ?? [];

async function lookup(url) {
  if (!(await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }))) {
    throw new Error("Needs access to this shop. Press Refresh to allow.");
  }
  // with cookies, so the shop sees the same visitor it sees in a tab
  const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The shop answered with ${res.status}`);
  const found = extractPrice(await res.text());
  if (!found) throw new Error("No price found on that page");
  return found;
}

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
