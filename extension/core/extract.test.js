import assert from "node:assert/strict";
import test from "node:test";
import { extractPrice, isNotFound, isUnavailable, parsePrice } from "./extract.js";

const ld = (data) => `<html><head><title>Fallback</title>
<script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;
const pick = (r) => r && { price: r.price, currency: r.currency, title: r.title };

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
  const r = extractPrice(html);
  assert.deepEqual(pick(r), { price: 49.9, currency: "EUR", title: "Desk & Lamp" });
  assert.equal(r.source, "data");
});

test("json-ld inside @graph with an offers array", () => {
  const html = ld({
    "@graph": [
      { "@type": "BreadcrumbList" },
      { "@type": ["Product", "Thing"], name: "Kettle", offers: [{ price: 35, priceCurrency: "GBP" }] },
    ],
  });
  assert.deepEqual(pick(extractPrice(html)), { price: 35, currency: "GBP", title: "Kettle" });
});

test("json-ld aggregate offer and price specification", () => {
  assert.equal(extractPrice(ld({ "@type": "Product", offers: { lowPrice: "12.00", priceCurrency: "USD" } })).price, 12);
  const spec = ld({
    "@type": "Product",
    offers: { priceCurrency: "SEK", priceSpecification: [{ price: "1299.00" }] },
  });
  assert.deepEqual(pick(extractPrice(spec)), { price: 1299, currency: "SEK", title: "Fallback" });
});

test("skips broken json-ld and falls back to meta tags", () => {
  const html = `<script type="application/ld+json">{oops</script>
    <meta property="og:title" content="Sneakers">
    <meta content="89.95" property="product:price:amount">
    <meta property="product:price:currency" content="USD">`;
  assert.deepEqual(pick(extractPrice(html)), { price: 89.95, currency: "USD", title: "Sneakers" });
});

test("microdata", () => {
  const html = `<title>Mug</title><meta itemprop="priceCurrency" content="CAD">
    <span itemprop="price">$ 14.50</span>`;
  assert.deepEqual(pick(extractPrice(html)), { price: 14.5, currency: "CAD", title: "Mug" });
});

test("currency missing from the offer is taken from the page", () => {
  // Walmart: no priceCurrency in the offer, "currencyUnit" in the page data
  const html = ld({ "@type": "Product", name: "AirPods", offers: { price: 270.49 } }) +
    `<script>window.__DATA__ = {"priceInfo":{"currentPrice":{"price":270.49,"currencyUnit":"USD"}}}</script>`;
  assert.equal(extractPrice(html).currency, "USD");
});

test("no price", () => {
  assert.equal(extractPrice("<html><title>About us</title></html>"), null);
});

// ---------- payment plans are never the price ----------

test("a monthly instalment next to the price is ignored", () => {
  // the shape of Apple's buy page
  const apple = `<title>Buy iPhone 16</title>
    <div class="rf-bfe-header-price">Buy from $799 or $33.29/mo. per month for 24 mo.</div>`;
  assert.equal(extractPrice(apple).price, 799);

  // the plan printed first, in its own price-labelled element
  const planFirst = `<span class="price-monthly">$33.29/mo.</span>
    <span class="product-price">$799.00</span>`;
  assert.equal(extractPrice(planFirst).price, 799);

  const perMonth = `<div class="price">€41,62 per month</div><div class="price-current">€999,00</div>`;
  assert.equal(extractPrice(perMonth).price, 999);

  const times = `<div class="price">12 x €83,25</div><div class="price-final">€999,00</div>`;
  assert.equal(extractPrice(times).price, 999);

  const klarna = `<div class="klarna-price">3 payments of $33.33</div><div class="sale-price">$99.99</div>`;
  assert.equal(extractPrice(klarna).price, 99.99);
});

test("only an instalment on the page: no price rather than the wrong one", () => {
  const html = `<div class="price">$33.29/mo.</div>`;
  assert.equal(extractPrice(html), null);
});

test("json-ld payment plans are skipped", () => {
  const html = ld({
    "@type": "Product",
    name: "Phone",
    offers: [
      { "@type": "Offer", price: "33.29", priceCurrency: "USD", priceSpecification: { billingDuration: 24 } },
      { "@type": "Offer", name: "Monthly installment", price: "33.29", priceCurrency: "USD" },
      { "@type": "Offer", price: "799.00", priceCurrency: "USD" },
    ],
  });
  assert.equal(extractPrice(html).price, 799);

  const unit = ld({
    "@type": "Product",
    offers: { "@type": "Offer", priceSpecification: { price: 41.62, billingIncrement: 1, unitCode: "MON" } },
  });
  assert.equal(extractPrice(unit), null);
});

test("amazon: only the main price box counts", () => {
  // trimmed from a real product page: shipping table, other sellers and a
  // monthly plan, all labelled "price"
  const html = `<title>Headphones</title>
    <span class="a-color-price a-text-bold">PLN 28.00</span>
    <div id="installmentPaymentPrice_feature_div"><span class="a-price"><span class="a-offscreen">PLN66.08</span></span>/mo</div>
    <div id="corePrice_feature_div"><span class="a-price aok-align-center priceToPay apex-pricetopay-value">
      <span class="a-offscreen">PLN793.01</span><span aria-hidden="true">PLN 793 . 01</span></span></div>`;
  const r = extractPrice(html, "https://www.amazon.com/dp/B09XS7JWHH");
  assert.equal(r.price, 793.01);
  assert.equal(r.currency, "PLN");
  assert.equal(r.source, "guess");

  const noMainPrice = `<span class="a-color-price">PLN 28.00</span><span class="a-price">PLN66.08</span>`;
  assert.equal(extractPrice(noMainPrice, "https://www.amazon.com/dp/B09XS7JWHH"), null);
});

test("amazon: a sponsored product's price-to-pay is not this product's", () => {
  // from a live page: the product itself has no featured offer, a sponsored
  // card further down uses the same "price to pay" classes
  const html = `<title>Sony WH-1000XM5</title>
    <div id="corePrice_desktop" class="celwidget"><div class="a-section"></div></div>
    <div id="apex_desktop" class="celwidget"></div>
    <span class="a-color-secondary twister_swatch_price">16 options from PLN 793.01</span>
    <div class="sp_detail"><a href="/sspa/click?pf_rd_p=x"><span class="a-price apex-price-to-pay-value">
      <span class="a-offscreen">PLN 332.78</span></span></a></div>`;
  assert.equal(extractPrice(html, "https://www.amazon.com/dp/B09XS7JWHH"), null);

  // a crossed-out list price inside the box is skipped for the real one
  const listed = `<div id="corePriceDisplay_desktop_feature_div">
    <span class="a-price a-text-price"><span class="a-offscreen">$399.99</span></span>
    <span class="a-price priceToPay"><span class="a-offscreen">$328.00</span></span></div>`;
  assert.equal(extractPrice(listed, "https://www.amazon.com/dp/B09XS7JWHH").price, 328);

  assert.equal(isUnavailable(`<div id="outOfStock" class="a-box">Currently unavailable.</div>`), true);
  assert.equal(isUnavailable(`<div id="buybox"><span>No featured offers available</span></div>`), true);
});

test("cents printed in their own element", () => {
  // Newegg: <strong>349</strong><sup>.99</sup>
  assert.equal(extractPrice(`<li class="price-current">$<strong>349</strong><sup>.99</sup></li>`).price, 349.99);
  assert.equal(extractPrice(`<span class="product-price">PLN <b>352</b> . <i>45</i></span>`).price, 352.45);
  assert.equal(extractPrice(`<span class="product-price">1 299,00 zł</span>`).price, 1299);
});

test("other products' prices are never this product's", () => {
  // a "not found" page that still lists recommendations
  const soft404 = `<title>Product not found : Target</title><h1>Product not found</h1>
    <div data-test="recommendations"><span data-test="current-price">$3.99</span></div>`;
  assert.equal(extractPrice(soft404), null);
  assert.equal(isNotFound(soft404), true);

  // the product's own price comes before "you may also like"
  const page = `<h1>Lamp</h1><span class="price">€49,00</span>
    <section class="you-may-also-like"><span class="current-price">€9,99</span></section>`;
  assert.equal(extractPrice(page).price, 49);
  const onlyRecs = `<h1>Lamp</h1><section class="product-recommendations"><span class="current-price">€9,99</span></section>`;
  assert.equal(extractPrice(onlyRecs), null);

  // no element names itself the price and the page shows several: no guess
  const category = `<ul><li class="tile-price">€5</li><li class="tile-price">€7</li></ul>`;
  assert.equal(extractPrice(category), null);
  // but an image carousel before the price doesn't hide it
  const gallery = `<div class="product-image-carousel"><img src=x></div><span class="price">€20,00</span>`;
  assert.equal(extractPrice(gallery).price, 20);
});

test("no structured data: reads the labelled price", () => {
  const plain = `<title>A Light in the Attic</title><p class="price_color">&pound;51.77</p>`;
  assert.deepEqual(pick(extractPrice(plain)), { price: 51.77, currency: "GBP", title: "A Light in the Attic" });

  const trailing = `<div data-testid="product-price"><b>1 299,00 zł</b></div>`;
  assert.deepEqual(pick(extractPrice(trailing)), { price: 1299, currency: "PLN", title: null });

  const code = `<span class="price">PLN 59.90</span>`;
  assert.equal(extractPrice(code).currency, "PLN");
});

test("no structured data: skips crossed-out prices and scripts", () => {
  const html = `<script>var x = '<b class="price">$1.00</b>'</script>
    <del class="price-old">€80,00</del><span class="price-now">€59,95</span>`;
  assert.equal(extractPrice(html).price, 59.95);
});

// ---------- availability ----------

test("availability from json-ld and from the page", () => {
  const out = ld({
    "@type": "Product",
    offers: { price: 10, priceCurrency: "EUR", availability: "https://schema.org/OutOfStock" },
  });
  assert.equal(extractPrice(out).available, false);
  assert.equal(isUnavailable(out), true);

  const inStock = ld({ "@type": "Product", offers: { price: 10, availability: "https://schema.org/InStock" } });
  assert.equal(extractPrice(inStock).available, true);
  assert.equal(isUnavailable(inStock), false);

  const amazon = `<div id="availability" class="a-section"><span class="a-color-price">Currently unavailable.</span></div>`;
  assert.equal(isUnavailable(amazon), true);
  assert.equal(isUnavailable(`<div class="stock-status">Sold out</div>`), true);
  assert.equal(isUnavailable(`<div id="availability"><span>In Stock</span></div>`), false);
});

// ---------- pictures ----------

test("picture from json-ld, og:image or the main product photo", () => {
  const product = { "@type": "Product", name: "Lamp", offers: { price: 5, priceCurrency: "EUR" } };
  assert.equal(extractPrice(ld({ ...product, image: ["https://cdn.test/a.jpg"] })).image, "https://cdn.test/a.jpg");
  assert.equal(extractPrice(ld({ ...product, image: { url: "https://cdn.test/c.jpg" } })).image, "https://cdn.test/c.jpg");
  assert.equal(extractPrice(ld({ ...product, image: "javascript:alert(1)" })).image, null);
  assert.equal(
    extractPrice(`<meta property="og:image" content="https://cdn.test/og.jpg">` + ld(product)).image,
    "https://cdn.test/og.jpg",
  );
  // amazon: no metadata, but the gallery image has a known id
  const amazon = `<img id="landingImage" src="https://m.media-amazon.com/s.jpg" data-old-hires="https://m.media-amazon.com/big.jpg">
    <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$10.00</span></span></div>`;
  assert.equal(extractPrice(amazon, "https://www.amazon.com/dp/B000000000").image, "https://m.media-amazon.com/big.jpg");
  // relative links resolve against the page
  const relative = `<meta property="og:image" content="/img/p.jpg">` + ld(product);
  assert.equal(extractPrice(relative, "https://shop.test/p/1").image, "https://shop.test/img/p.jpg");
});

test("the shop's icon is kept as a fallback picture", () => {
  const html = `<link rel="icon" href="/favicon-32.png"><link rel="apple-touch-icon" href="/touch.png">` + ld({ "@type": "Product", offers: { price: 1 } });
  assert.equal(extractPrice(html, "https://shop.test/p").icon, "https://shop.test/touch.png");
  assert.equal(extractPrice(ld({ "@type": "Product", offers: { price: 1 } }), "https://shop.test/p").icon, "https://shop.test/favicon.ico");
});
