// Runs the real background script against a fake `chrome` and a fake shop.
import assert from "node:assert/strict";
import test from "node:test";
import { newItem } from "./core/items.js";

const store = { items: [newItem("https://shop.test/p/1", { price: 20, currency: "EUR", title: "Thing" })] };
const notified = [];
const listeners = {};
const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });

globalThis.chrome = {
  alarms: { create() {}, onAlarm: on("alarm") },
  runtime: { onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
  notifications: { create: (id, options) => notified.push(options), clear() {}, onClicked: on("clicked") },
  permissions: { contains: async () => true },
  storage: {
    local: {
      get: async () => structuredClone(store),
      set: async (values) => void Object.assign(store, structuredClone(values)),
    },
  },
};

let shop = () => new Response("");
globalThis.fetch = async () => shop();

await import("./background.js");
const check = () => new Promise((done) => listeners.message("check", null, done));

test("a changed price is recorded and announced", async () => {
  shop = () => new Response(`<meta property="product:price:amount" content="15.00">`);
  await check();
  assert.deepEqual(
    store.items[0].history.map((pt) => pt.p),
    [20, 15],
  );
  assert.equal(notified.length, 1);
  assert.match(notified[0].title, /^Price drop: Thing/);
});

test("an unchanged price stays quiet", async () => {
  await check();
  assert.equal(store.items[0].history.length, 2);
  assert.equal(notified.length, 1);
});

test("a failed check keeps the history and stores the reason", async () => {
  shop = () => new Response("", { status: 503 });
  await check();
  assert.equal(store.items[0].history.length, 2);
  assert.equal(store.items[0].error, "The shop answered with 503");
});
