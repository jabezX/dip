import assert from "node:assert/strict";
import test from "node:test";
import { isItem, isWatched, newItem, productKey, record } from "./items.js";

test("the same product is recognised however the link was copied", () => {
  const items = [newItem("https://www.shop.test/p/lamp/?color=red&size=2", { price: 1, currency: null, title: "Lamp" })];
  assert.equal(isWatched(items, "https://shop.test/p/lamp?size=2&color=red&utm_source=mail&fbclid=x#reviews"), true);
  assert.equal(isWatched(items, "https://shop.test/p/lamp?color=blue&size=2"), false);
  assert.equal(isWatched(items, "https://shop.test/p/desk"), false);
  assert.equal(
    productKey("https://www.amazon.com/Some-Long-Title/dp/b0d1xd1zv3/ref=sr_1_1?th=1"),
    productKey("https://amazon.com/gp/product/B0D1XD1ZV3"),
  );
});

test("isItem rejects malformed and unsafe entries", () => {
  const good = newItem("https://shop.test/p/1", { price: 20, currency: null, title: "Thing" });
  assert.equal(isItem(good), true);
  assert.equal(isItem(JSON.parse(JSON.stringify(good))), true);
  assert.equal(isItem({ ...good, url: "javascript:alert(1)" }), false);
  assert.equal(isItem({ ...good, history: [] }), false);
  assert.equal(isItem({ ...good, history: [{ t: 1, p: "20" }] }), false);
  assert.equal(isItem(null), false);
});

test("record only adds a point when the price changes", () => {
  const item = newItem("https://shop.test/p/1", { price: 20, currency: "EUR", title: "Thing" }, 1);
  assert.equal(item.history.length, 1);

  const same = record(item, { price: 20, currency: "EUR", title: "Thing" }, 2);
  assert.equal(same.previous, null);
  assert.equal(same.item.history.length, 1);
  assert.equal(same.item.checkedAt, 2);

  const drop = record({ ...same.item, error: "timeout" }, { price: 15, currency: null, title: null }, 3);
  assert.equal(drop.previous, 20);
  assert.deepEqual(drop.item.history, [
    { t: 1, p: 20 },
    { t: 3, p: 15 },
  ]);
  assert.equal(drop.item.currency, "EUR");
  assert.equal(drop.item.error, undefined);
});
