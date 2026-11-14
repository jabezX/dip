// Runs the real background script against a fake `chrome` and a fake shop.
import assert from "node:assert/strict";
import test from "node:test";
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

globalThis.DIP_TEST = true;
globalThis.fetch = async () => shop();
globalThis.chrome = {
  alarms: { create() {}, onAlarm: on("alarm") },
  runtime: { onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
  notifications: { create: (id, options) => notified.push(options), clear() {}, onClicked: on("clicked") },
  permissions: { contains: async ({ origins }) => !origins[0].includes("forbidden") },
  scripting: { executeScript: async (call) => (injected.push(call), [{ result: rendered }]) },
  tabs: {
    create: async () => (tabsOpened++, { id: 7 }),
    remove: async () => {},
    onUpdated: {
      addListener: (fn) => (updated.push(fn), queueMicrotask(() => fn(7, { status: "complete" }))),
      removeListener() {},
    },
  },
  storage: {
    local: {
      get: async () => structuredClone(store),
      set: async (values) => void Object.assign(store, structuredClone(values)),
    },
  },
};

await import("./background.js");
const send = (message) => new Promise((done) => listeners.message(message, null, done));
const prices = () => store.items[0].history.map((pt) => pt.p);

test("a changed price is recorded and announced", async () => {
  shop = () => new Response(`<meta property="product:price:amount" content="15.00">`);
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
  assert.deepEqual(prices(), [20, 15, 12.5]);
  assert.equal(tabsOpened, 1);
});

test("a failed check keeps the history and stores the reason", async () => {
  shop = () => new Response("", { status: 503 });
  rendered = "";
  await send("check");
  assert.deepEqual(prices(), [20, 15, 12.5]);
  assert.equal(store.items[0].error, "The shop answered with 503");
});

test("lookups for the web app", async () => {
  shop = () => new Response(`<meta property="product:price:amount" content="9.99">`);
  assert.equal((await send({ type: "lookup", url: "https://other.test/p" })).found.price, 9.99);
  assert.match((await send({ type: "lookup", url: "https://forbidden.test/p" })).error, /isn't allowed/);
  assert.match((await send({ type: "lookup", url: "file:///etc/passwd" })).error, /Only http/);
});

// ---------- "Watch this price?" suggestions ----------

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
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
