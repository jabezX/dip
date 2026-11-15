// Runs the real background script against a fake `chrome` and a fake shop.
import assert from "node:assert/strict";
import test from "node:test";
import { DEV_TEST } from "./core/dev.js";
import { newItem } from "./core/items.js";

const store = { items: [newItem("https://shop.test/p/1", { price: 20, currency: "EUR", title: "Thing" })] };
const notified = [];
const listeners = {};
const on = (name) => ({ addListener: (fn) => (listeners[name] = fn), removeListener() {} });

let shop = () => new Response(""); // what a plain fetch gets
let rendered = ""; // what the page looks like after its scripts ran
let tabsOpened = 0;
const injected = []; // every scripting.executeScript call
const updated = []; // tabs.onUpdated listeners; the first is the suggestion one
const alarms = new Map();

globalThis.DIP_TEST = true;
globalThis.fetch = async () => shop();
globalThis.chrome = {
  alarms: {
    create: async (name, info) => void alarms.set(name, info),
    get: async (name) => alarms.get(name),
    clear: async (name) => alarms.delete(name),
    onAlarm: on("alarm"),
  },
  runtime: { getManifest: () => ({}), onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
  notifications: { create: (id, options) => notified.push({ id, ...options }), clear() {}, onClicked: on("clicked") },
  permissions: { contains: async ({ origins }) => !origins[0].includes("forbidden") },
  scripting: { executeScript: async (call) => (injected.push(call), [{ result: rendered }]) },
  windows: {
    create: async () => (tabsOpened++, { id: 70, tabs: [{ id: 7 }] }),
    remove: async () => {},
  },
  tabs: {
    create: async () => ({ id: 8 }),
    remove: async () => {},
    onUpdated: {
      addListener: (fn) => (updated.push(fn), queueMicrotask(() => fn(7, { status: "complete" }))),
      removeListener() {},
    },
  },
  storage: {
    local: {
      get: async () => structuredClone(store),
      set: async (values) => {
        const changes = Object.fromEntries(Object.keys(values).map((k) => [k, { oldValue: store[k], newValue: values[k] }]));
        Object.assign(store, structuredClone(values));
        listeners.storage?.(changes);
      },
    },
    onChanged: on("storage"),
  },
};

await import("./background.js");
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const send = (message) => new Promise((done) => listeners.message(message, null, done));
const prices = () => store.items[0].history.map((pt) => pt.p);
const meta = (price) => `<meta property="product:price:amount" content="${price}">`;

test("a changed price is recorded and announced", async () => {
  shop = () => new Response(meta("15.00"));
  await send("check");
  assert.deepEqual(prices(), [20, 15]);
  assert.equal(notified.length, 1);
  assert.match(notified[0].title, /^Price drop: Thing/);
  assert.equal(tabsOpened, 0);
});

test("an unchanged price stays quiet", async () => {
  await send("check");
  assert.deepEqual(prices(), [20, 15]);
  assert.equal(notified.length, 1);
});

test("a price filled in by scripts is read from the rendered page", async () => {
  shop = () => new Response("<div id=app></div>");
  rendered = `<div id=app><span class="price">€12,50</span></div>`;
  await send("check");
  // read off the page while the last price came from structured data: held
  // back until a second check agrees
  assert.deepEqual(prices(), [20, 15]);
  assert.equal(store.items[0].pending.p, 12.5);
  assert.equal(notified.length, 1);
  await send("check");
  assert.deepEqual(prices(), [20, 15, 12.5]);
  assert.equal(notified.length, 2);
  assert.equal(tabsOpened, 2);
});

test("a failed check keeps the history and stores the reason", async () => {
  shop = () => new Response("", { status: 503 });
  rendered = "";
  await send("check");
  assert.deepEqual(prices(), [20, 15, 12.5]);
  assert.equal(store.items[0].error, "Shop answered 503");
});

test("a removed page is marked unlisted, an out-of-stock one unavailable", async () => {
  shop = () => new Response("Not found", { status: 404 });
  await send("check");
  assert.equal(store.items[0].gone, true);

  shop = () => new Response(`<div id="availability"><span>Currently unavailable.</span></div>`);
  await send("check");
  assert.equal(store.items[0].gone, undefined);
  assert.equal(store.items[0].available, false);

  shop = () => new Response(meta("12.50"));
  await send("check");
  assert.equal(store.items[0].available, undefined); // back in stock
  assert.deepEqual(prices(), [20, 15, 12.5]);
});

test("only due items are checked on the timer, all of them by hand", async () => {
  store.prefs = { every: { n: 2, unit: "hours" } };
  shop = () => new Response(meta("11.00"));
  store.items[0].checkedAt = Date.now() - 60 * 60_000; // an hour ago: not due
  listeners.alarm({ name: "check" });
  await settle();
  assert.deepEqual(prices(), [20, 15, 12.5]);

  store.items[0].checkedAt = Date.now() - 3 * 60 * 60_000; // three hours ago: due
  listeners.alarm({ name: "check" });
  await settle();
  assert.deepEqual(prices(), [20, 15, 12.5, 11]);
});

test("changing the interval reschedules the alarm", async () => {
  await chrome.storage.local.set({ prefs: { every: { n: 15, unit: "minutes" } } });
  await settle();
  assert.equal(alarms.get("check").periodInMinutes, 15);
  await chrome.storage.local.set({ prefs: { every: { n: 1, unit: "weeks" } } });
  await settle();
  assert.equal(alarms.get("check").periodInMinutes, 60); // still wakes hourly to catch up
});

test("the test product alerts every minute until it's removed", async () => {
  const before = notified.length;
  await chrome.storage.local.set({ items: [newItem(DEV_TEST.url, DEV_TEST.found()), ...store.items] });
  await settle();
  assert.equal(alarms.get("test").periodInMinutes, 1);

  for (let minute = 0; minute < 3; minute++) {
    listeners.alarm({ name: "test" });
    await settle();
  }
  assert.equal(notified.length, before + 3);
  assert.equal(new Set(notified.slice(-3).map((n) => n.id)).size, 3); // each one pops up, none replaced
  assert.equal(store.items[1].history.length, 4); // the real product wasn't touched

  await chrome.storage.local.set({ items: store.items.filter((i) => i.url !== DEV_TEST.url) });
  await settle();
  assert.equal(alarms.has("test"), false);
});

test("a product read from the plain page is never re-read from the rendered one", async () => {
  // the plain page and the page after its scripts show different offers
  const item = { ...newItem("https://twoprices.test/p", { price: 409, currency: "USD", title: "CPU" }), via: "fetch" };
  await chrome.storage.local.set({ items: [item] });
  shop = () => new Response("<div id=app></div>");
  rendered = `<span class="price-current">$349.99</span>`;
  const opened = tabsOpened;
  await send("check");
  assert.deepEqual(store.items[0].history.map((pt) => pt.p), [409]);
  assert.equal(store.items[0].error, "No price found");
  assert.equal(tabsOpened, opened, "no rendered read");

  // and one read from the rendered page is always rendered
  await chrome.storage.local.set({ items: [{ ...item, via: "render", history: [{ t: 1, p: 349.99 }] }] });
  shop = () => new Response(`<span class="price-current">$409.00</span>`);
  await send("check");
  assert.deepEqual(store.items[0].history.map((pt) => pt.p), [349.99]);
  assert.equal(store.items[0].error, undefined);
});

test("probe: added from a tab, checked the cheap way only if the plain page agrees", async () => {
  const a = newItem("https://same.test/p", { price: 10, currency: "EUR", title: "A" });
  const b = newItem("https://differs.test/p", { price: 10, currency: "EUR", title: "B" });
  await chrome.storage.local.set({ items: [a, b] });
  shop = () => new Response(meta("10.00"));
  listeners.message({ type: "probe", id: a.id }, null, () => {});
  await settle();
  shop = () => new Response(meta("12.00"));
  listeners.message({ type: "probe", id: b.id }, null, () => {});
  await settle();
  assert.equal(store.items.find((i) => i.id === a.id).via, "fetch");
  assert.equal(store.items.find((i) => i.id === b.id).via, "render");
});

test("a page that says \"not found\" is unlisted, not some other product's price", async () => {
  await chrome.storage.local.set({ items: [newItem("https://soft404.test/p", { price: 20, currency: "USD", title: "Mug" })] });
  shop = () =>
    new Response(`<title>Product not found</title><h1>Product not found</h1><span class="current-price">$3.99</span>`);
  await send("check");
  assert.equal(store.items[0].gone, true);
  assert.deepEqual(store.items[0].history.map((pt) => pt.p), [20]);
});

test("lookups for the web app", async () => {
  shop = () => new Response(meta("9.99"));
  assert.equal((await send({ type: "lookup", url: "https://other.test/p" })).found.price, 9.99);
  assert.match((await send({ type: "lookup", url: "https://forbidden.test/p" })).error, /No access/);
  assert.match((await send({ type: "lookup", url: "file:///etc/passwd" })).error, /Only http/);
  shop = () => new Response("", { status: 410 });
  assert.equal((await send({ type: "lookup", url: "https://other.test/gone" })).gone, true);
});

// ---------- "Watch this price?" suggestions ----------

const pageLoaded = async (url) => {
  injected.length = 0;
  updated[0](3, { status: "complete" }, { url });
  await settle();
};
const product = `<script type="application/ld+json">
  {"@type":"Product","name":"Mug","offers":{"price":"8.00","priceCurrency":"EUR"}}</script>`;

test("a product page gets a suggestion, and watching it adds it once", async () => {
  rendered = product;
  await pageLoaded("https://newshop.test/p/mug");
  assert.equal(injected.length, 2); // read the page, then show the card
  const [{ url, found, price }] = injected[1].args;
  assert.equal(found.title, "Mug");
  assert.match(price, /8/);

  listeners.message({ type: "suggestion", answer: "watch", url, found }, null, () => {});
  await settle();
  assert.equal(store.items[0].title, "Mug");

  await pageLoaded("https://www.newshop.test/p/mug?utm_source=mail");
  assert.equal(injected.length, 0); // already watched: the page isn't even read
});

test("pages that aren't products get no suggestion", async () => {
  rendered = `<ul><li><span class="price">€5,00</span></li><li><span class="price">€7,00</span></li></ul>`;
  await pageLoaded("https://newshop.test/category/mugs");
  assert.equal(injected.length, 1); // read, nothing shown
});

test("'not now' and 'don't ask on this site' are remembered", async () => {
  rendered = product;
  const found = { price: 8, currency: "EUR", title: "Cup", image: null };
  listeners.message({ type: "suggestion", answer: "later", url: "https://newshop.test/p/cup", found }, null, () => {});
  await settle();
  await pageLoaded("https://newshop.test/p/cup");
  assert.equal(injected.length, 0);

  listeners.message({ type: "suggestion", answer: "mute", url: "https://quiet.test/p/1", found }, null, () => {});
  await settle();
  await pageLoaded("https://quiet.test/p/2");
  assert.equal(injected.length, 0);

  store.prefs = { suggest: false };
  await pageLoaded("https://newshop.test/p/plate");
  assert.equal(injected.length, 0);
});

test("a check asked for while another runs waits its turn instead of being dropped", async () => {
  await chrome.storage.local.set({ items: [newItem("https://queue.test/p", { price: 5, currency: "EUR", title: "Q" })] });
  let fetches = 0;
  shop = () => (fetches++, new Response(meta("5.00")));
  await Promise.all([send("check"), send("check")]);
  assert.equal(fetches, 2);
});
