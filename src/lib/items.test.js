import assert from "node:assert/strict";
import test from "node:test";
import { newItem, record } from "./items.js";

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
