import assert from "node:assert/strict";
import test from "node:test";
import { extractPrice, parsePrice } from "./extract.js";

const ld = (data) => `<html><head><title>Fallback</title>
<script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

test("parsePrice handles common formats", () => {
  assert.equal(parsePrice(19.99), 19.99);
  assert.equal(parsePrice("19.99"), 19.99);
  assert.equal(parsePrice("1,299.00"), 1299);
  assert.equal(parsePrice("1.299,00"), 1299);
  assert.equal(parsePrice("€ 19,99"), 19.99);
  assert.equal(parsePrice("1,299"), 1299);
  assert.equal(parsePrice("1.299.000"), 1299000);
  assert.equal(parsePrice("1 299,50 kr."), 1299.5);
  assert.equal(parsePrice("free"), null);
  assert.equal(parsePrice(null), null);
});

test("json-ld product", () => {
  const html = ld({
    "@type": "Product",
    name: "Desk &amp; Lamp",
    offers: { "@type": "Offer", price: "49.90", priceCurrency: "eur" },
  });
  assert.deepEqual(extractPrice(html), { price: 49.9, currency: "EUR", title: "Desk & Lamp" });
});

test("json-ld inside @graph with an offers array", () => {
  const html = ld({
    "@graph": [
      { "@type": "BreadcrumbList" },
      { "@type": ["Product", "Thing"], name: "Kettle", offers: [{ price: 35, priceCurrency: "GBP" }] },
    ],
  });
  assert.deepEqual(extractPrice(html), { price: 35, currency: "GBP", title: "Kettle" });
});

test("json-ld aggregate offer and price specification", () => {
  assert.equal(extractPrice(ld({ "@type": "Product", offers: { lowPrice: "12.00", priceCurrency: "USD" } })).price, 12);
  const spec = ld({
    "@type": "Product",
    offers: { priceCurrency: "SEK", priceSpecification: [{ price: "1299.00" }] },
  });
  assert.deepEqual(extractPrice(spec), { price: 1299, currency: "SEK", title: "Fallback" });
});

test("skips broken json-ld and falls back to meta tags", () => {
  const html = `<script type="application/ld+json">{oops</script>
    <meta property="og:title" content="Sneakers">
    <meta content="89.95" property="product:price:amount">
    <meta property="product:price:currency" content="USD">`;
  assert.deepEqual(extractPrice(html), { price: 89.95, currency: "USD", title: "Sneakers" });
});

test("microdata", () => {
  const html = `<title>Mug</title><meta itemprop="priceCurrency" content="CAD">
    <span itemprop="price">$ 14.50</span>`;
  assert.deepEqual(extractPrice(html), { price: 14.5, currency: "CAD", title: "Mug" });
});

test("no price", () => {
  assert.equal(extractPrice("<html><title>About us</title></html>"), null);
});
