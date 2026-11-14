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
  assert.deepEqual(extractPrice(html), { price: 49.9, currency: "EUR", title: "Desk & Lamp", image: null });
});

test("json-ld inside @graph with an offers array", () => {
  const html = ld({
    "@graph": [
      { "@type": "BreadcrumbList" },
      { "@type": ["Product", "Thing"], name: "Kettle", offers: [{ price: 35, priceCurrency: "GBP" }] },
    ],
  });
  assert.deepEqual(extractPrice(html), { price: 35, currency: "GBP", title: "Kettle", image: null });
});

test("json-ld aggregate offer and price specification", () => {
  assert.equal(extractPrice(ld({ "@type": "Product", offers: { lowPrice: "12.00", priceCurrency: "USD" } })).price, 12);
  const spec = ld({
    "@type": "Product",
    offers: { priceCurrency: "SEK", priceSpecification: [{ price: "1299.00" }] },
  });
  assert.deepEqual(extractPrice(spec), { price: 1299, currency: "SEK", title: "Fallback", image: null });
});

test("skips broken json-ld and falls back to meta tags", () => {
  const html = `<script type="application/ld+json">{oops</script>
    <meta property="og:title" content="Sneakers">
    <meta content="89.95" property="product:price:amount">
    <meta property="product:price:currency" content="USD">`;
  assert.deepEqual(extractPrice(html), { price: 89.95, currency: "USD", title: "Sneakers", image: null });
});

test("microdata", () => {
  const html = `<title>Mug</title><meta itemprop="priceCurrency" content="CAD">
    <span itemprop="price">$ 14.50</span>`;
  assert.deepEqual(extractPrice(html), { price: 14.5, currency: "CAD", title: "Mug", image: null });
});

test("picture from json-ld or og:image", () => {
  const product = { "@type": "Product", name: "Lamp", offers: { price: 5, priceCurrency: "EUR" } };
  assert.equal(extractPrice(ld({ ...product, image: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"] })).image, "https://cdn.test/a.jpg");
  assert.equal(extractPrice(ld({ ...product, image: { url: "https://cdn.test/c.jpg" } })).image, "https://cdn.test/c.jpg");
  assert.equal(extractPrice(ld({ ...product, image: "javascript:alert(1)" })).image, null);
  assert.equal(
    extractPrice(`<meta property="og:image" content="https://cdn.test/og.jpg">` + ld(product)).image,
    "https://cdn.test/og.jpg",
  );
});

test("no structured data: reads the labelled price", () => {
  const plain = `<title>A Light in the Attic</title><p class="price_color">&pound;51.77</p><p>In stock (22 available)</p>`;
  assert.deepEqual(extractPrice(plain), { price: 51.77, currency: "GBP", title: "A Light in the Attic", image: null });

  const nested = `<span class="a-price"><span class="a-offscreen">$1,189.99</span><span aria-hidden="true">$1,189</span></span>`;
  assert.equal(extractPrice(nested).price, 1189.99);

  const trailing = `<div data-testid="product-price"><b>1 299,00 zł</b></div>`;
  assert.deepEqual(extractPrice(trailing), { price: 1299, currency: "PLN", title: null, image: null });
});

test("no structured data: skips crossed-out prices and scripts", () => {
  const html = `<script>var x = '<b class="price">$1.00</b>'</script>
    <del class="price-old">€80,00</del><span class="price-now">€59,95</span>`;
  assert.equal(extractPrice(html).price, 59.95);
});

test("a product without offers still names the shown price", () => {
  const html = ld({ "@type": "Product", name: "Swim short", image: "https://cdn.test/s.jpg", offers: {} });
  assert.deepEqual(extractPrice(html + `<span class="current-price">£32.00</span>`), {
    price: 32,
    currency: "GBP",
    title: "Swim short",
    image: "https://cdn.test/s.jpg",
  });
});

test("no price", () => {
  assert.equal(extractPrice("<html><title>About us</title></html>"), null);
});
