import assert from "node:assert/strict";
import test from "node:test";
import {
  ago,
  everyMinutes,
  failed,
  isDue,
  isItem,
  isWatched,
  newItem,
  organize,
  productKey,
  record,
  status,
} from "./items.js";

const found = (price, more) => ({ price, currency: "EUR", title: "Thing", ...more });

test("the same product is recognised however the link was copied", () => {
  const items = [newItem("https://www.shop.test/p/lamp/?color=red&size=2", found(1))];
  assert.equal(isWatched(items, "https://shop.test/p/lamp?size=2&color=red&utm_source=mail&fbclid=x#reviews"), true);
  assert.equal(isWatched(items, "https://shop.test/p/lamp?color=blue&size=2"), false);
  assert.equal(isWatched(items, "https://shop.test/p/desk"), false);
  assert.equal(
    productKey("https://www.amazon.com/Some-Long-Title/dp/b0d1xd1zv3/ref=sr_1_1?th=1"),
    productKey("https://amazon.com/gp/product/B0D1XD1ZV3"),
  );
});

test("isItem rejects malformed and unsafe entries", () => {
  const good = newItem("https://shop.test/p/1", found(20));
  assert.equal(isItem(good), true);
  assert.equal(isItem(JSON.parse(JSON.stringify(good))), true);
  assert.equal(isItem({ ...good, url: "javascript:alert(1)" }), false);
  assert.equal(isItem({ ...good, image: "javascript:alert(1)" }), false);
  assert.equal(isItem({ ...good, history: [] }), false);
  assert.equal(isItem({ ...good, history: [{ t: 1, p: "20" }] }), false);
  assert.equal(isItem(null), false);
});

test("record only adds a point when the price changes", () => {
  const item = newItem("https://shop.test/p/1", found(20), 1);
  const same = record(item, found(20), 2);
  assert.equal(same.previous, null);
  assert.equal(same.item.history.length, 1);
  assert.equal(same.item.checkedAt, 2);

  const drop = record({ ...same.item, error: "timeout" }, found(15, { currency: null }), 3);
  assert.equal(drop.previous, 20);
  assert.deepEqual(drop.item.history, [
    { t: 1, p: 20 },
    { t: 3, p: 15 },
  ]);
  assert.equal(drop.item.currency, "EUR");
  assert.equal(drop.item.error, undefined);
});

test("a too-good-to-be-true drop is only recorded once it's seen twice", () => {
  // 799 → 33.29 is a monthly instalment misread as the price
  const item = newItem("https://shop.test/phone", found(799, { source: "data" }), 1);
  const first = record(item, found(33.29, { source: "data" }), 2);
  assert.equal(first.previous, null, "no alert");
  assert.equal(first.item.history.length, 1, "not in the history");
  assert.equal(first.item.pending.p, 33.29);

  // the next check reads the real price again: the blip is dropped
  const back = record(first.item, found(799, { source: "data" }), 3);
  assert.equal(back.previous, null);
  assert.equal(back.item.pending, undefined);
  assert.equal(back.item.history.length, 1);

  // a real clearance shows the same price twice in a row
  const once = record(item, found(199, { source: "data" }), 4);
  assert.equal(once.previous, null);
  const twice = record(once.item, found(199, { source: "data" }), 5);
  assert.equal(twice.previous, 799);
  assert.deepEqual(
    twice.item.history.map((pt) => pt.p),
    [799, 199],
  );
});

test("a guessed price that disagrees with structured data needs a second look", () => {
  const item = newItem("https://shop.test/p", found(100, { source: "data" }), 1);
  const guessed = record(item, found(90, { source: "guess" }), 2);
  assert.equal(guessed.previous, null);
  assert.equal(guessed.item.source, "data");
  const again = record(guessed.item, found(90, { source: "guess" }), 3);
  assert.equal(again.previous, 100);

  // ordinary moves of a guessed price go straight through
  const plain = newItem("https://shop.test/q", found(100, { source: "guess" }), 1);
  assert.equal(record(plain, found(90, { source: "guess" }), 2).previous, 100);
});

test("availability and failures", () => {
  const item = newItem("https://shop.test/p", found(10), 1);
  assert.equal(status(item), "ok");
  assert.equal(status(record(item, found(10, { available: false })).item), "out");
  assert.equal(status(failed(item, { message: "Unlisted", gone: true })), "unlisted");
  assert.equal(status(failed(item, { message: "Unavailable", unavailable: true })), "out");
  const broken = failed(item, { message: "Shop answered 503" });
  assert.equal(status(broken), "error");
  assert.equal(status(record(broken, found(10)).item), "ok");
  assert.equal(failed(item, { message: "x", gone: true }).history.length, 1, "history kept");
});

test("ago", () => {
  const now = Date.UTC(2026, 10, 14);
  const min = 60_000;
  assert.equal(ago(now - 20_000, now), "just now");
  assert.equal(ago(now - 5 * min, now), "5 minutes ago");
  assert.equal(ago(now - 2 * 60 * min, now), "2 hours ago");
  assert.equal(ago(now - 7 * 24 * 60 * min, now), "7 days ago");
  assert.equal(ago(now - 40 * 24 * 60 * min, now), "1 month ago");
  assert.equal(ago(now - 400 * 24 * 60 * min, now), "1 year ago");
});

test("check interval", () => {
  assert.equal(everyMinutes({ n: 15, unit: "minutes" }), 15);
  assert.equal(everyMinutes({ n: 2, unit: "days" }), 2880);
  assert.equal(everyMinutes({ n: 1, unit: "months" }), 43_200);
  assert.equal(everyMinutes(undefined), 60);
  assert.equal(everyMinutes({ n: -3, unit: "hours" }), 60);
  assert.equal(everyMinutes({ n: 2, unit: "fortnights" }), 60);
  const item = { checkedAt: 0 };
  assert.equal(isDue(item, { n: 1, unit: "hours" }, 30 * 60_000), false);
  assert.equal(isDue(item, { n: 1, unit: "hours" }, 60 * 60_000), true);
});

test("organize: search, filter and sort", () => {
  const make = (url, title, prices, extra) => ({
    ...newItem(url, found(prices[0], { title })),
    history: prices.map((p, t) => ({ t, p })),
    ...extra,
  });
  const items = [
    make("https://www.ikea.com/a", "Lamp", [50, 40], { list: "Home" }),
    make("https://shop.test/b", "Desk", [200, 220], { list: "Home" }),
    make("https://www.amazon.com/c", "Headphones", [300, 150], { available: false }),
  ];
  const titles = (view) => organize(items, view).map((i) => i.title);
  assert.deepEqual(titles(), ["Lamp", "Desk", "Headphones"]);
  assert.deepEqual(titles({ q: "ikea" }), ["Lamp"]);
  assert.deepEqual(titles({ show: "drops" }), ["Lamp", "Headphones"]);
  assert.deepEqual(titles({ show: "out" }), ["Headphones"]);
  assert.deepEqual(titles({ show: "list:Home" }), ["Lamp", "Desk"]);
  assert.deepEqual(titles({ sort: "drop" }), ["Headphones", "Lamp", "Desk"]);
  assert.deepEqual(titles({ sort: "price" }), ["Lamp", "Headphones", "Desk"]);
  assert.deepEqual(titles({ sort: "name" }), ["Desk", "Headphones", "Lamp"]);
  assert.deepEqual(items.map((i) => i.title), ["Lamp", "Desk", "Headphones"], "input untouched");
});
