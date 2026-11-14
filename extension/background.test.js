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

globalThis.DIP_TEST = true;
globalThis.fetch = async () => shop();
globalThis.chrome = {
  alarms: { create() {}, onAlarm: on("alarm") },
  runtime: { onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
  notifications: { create: (id, options) => notified.push(options), clear() {}, onClicked: on("clicked") },
  permissions: { contains: async ({ origins }) => !origins[0].includes("forbidden") },
  scripting: { executeScript: async () => [{ result: rendered }] },
  tabs: {
    create: async () => (tabsOpened++, { id: 7 }),
    remove: async () => {},
    onUpdated: {
      addListener: (fn) => queueMicrotask(() => fn(7, { status: "complete" })),
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
