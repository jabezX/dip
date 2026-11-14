// Read a product's price, picture and availability out of raw HTML.
// String-only on purpose: this runs in Node and in an extension service
// worker, and neither has a DOM.

/**
 * @typedef {object} Extracted
 * @property {number} price
 * @property {string | null} currency
 * @property {string | null} title
 * @property {string | null} image      product picture
 * @property {string | null} icon       the shop's icon, as a fallback picture
 * @property {boolean | null} available false when the page says it can't be bought
 * @property {"data" | "guess"} source  "data": the shop's structured data. "guess": read off the page.
 */

/**
 * "1,299.00", "1.299,00", "€ 19,99", 19.99 -> number
 * @param {unknown} v
 * @returns {number | null}
 */
export function parsePrice(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if (!s) return null;
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    // both present: whichever comes last is the decimal separator
    const [dec, thou] = dot > comma ? [".", ","] : [",", "."];
    s = s.replaceAll(thou, "").replace(dec, ".");
  } else if (comma >= 0) {
    // "1,299" and "1,299,000" are thousands, "19,99" is a decimal
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replaceAll(",", "") : s.replace(",", ".");
  } else if (s.indexOf(".") !== dot) {
    s = s.replaceAll(".", ""); // "1.299.000"
  }
  // ponytail: a lone "1.299" reads as 1.299 (schema.org says "." is the
  // decimal separator). Shops that ignore the spec need a per-locale hint.
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Does the page declare itself a product? Listing and home pages have prices
 * too, so "found a price" alone doesn't say it's a product page.
 * @param {string} html
 */
export const isProductPage = (html) =>
  /"@type"\s*:\s*(\[[^\]]*)?"Product"|property=["']og:type["'][^>]*content=["'](og:)?product|product:price:amount|itemprop=["']?price["'\s>]/i.test(
    html,
  );

const GONE = /out\s*_?of\s*_?stock|sold\s*_?out|discontinued|unavailable|not available|no longer available|cannot be shipped/i;

/**
 * Does the page say the product can't be bought right now?
 * @param {string} html
 */
export function isUnavailable(html) {
  // structured data, unless some offer on the page is still in stock
  if (/"availability"\s*:\s*"[^"]*(OutOfStock|SoldOut|Discontinued)/i.test(html)) {
    return !/"availability"\s*:\s*"[^"]*(InStock|LimitedAvailability|PreOrder|OnlineOnly)/i.test(html);
  }
  if (GONE.test(metas(html)["product:availability"] ?? metas(html)["og:availability"] ?? "")) return true;
  // an availability box that says so (Amazon's "Currently unavailable")
  const body = visible(html);
  for (const m of body.matchAll(/<[a-z0-9]+\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*(?:availability|out-?of-?stock|sold-?out|stock-?status)[^"']*["'][^>]*>/gi)) {
    if (GONE.test(text(body.slice(m.index + m[0].length, m.index + m[0].length + 500)).slice(0, 160))) return true;
  }
  return false;
}

/**
 * @param {string} html
 * @param {string} [url] the page's address: resolves relative picture links and enables shop-specific care
 * @returns {Extracted | null}
 */
export function extractPrice(html, url) {
  const meta = metas(html);
  let name;
  let picture;
  /** @returns {Extracted} */
  const done = (price, currency, source, available = null) => ({
    price,
    currency: typeof currency === "string" && currency ? currency.toUpperCase() : null,
    title: decode(
      typeof name === "string" && name.trim() ? name : (meta["og:title"] ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]),
    ),
    image: findImage(picture, meta, html, url),
    icon: findIcon(html, url),
    available: available ?? (isUnavailable(html) ? false : null),
    source,
  });

  // 1. schema.org JSON-LD
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      // a Product without offers still knows its name and picture
      const product = findProduct(data, true) ?? findProduct(data, false);
      if (!product) continue;
      name ??= product.name;
      picture ??= product.image;
      if (product.offer) return done(product.offer.price, product.offer.currency, "data", product.offer.available);
    } catch {
      // malformed JSON-LD is common, keep looking
    }
  }

  // 2. Open Graph / microdata with a content attribute
  const price = parsePrice(meta["product:price:amount"] ?? meta["og:price:amount"] ?? meta["price"]);
  if (price != null) {
    return done(price, meta["product:price:currency"] ?? meta["og:price:currency"] ?? meta["pricecurrency"], "data");
  }

  // 3. microdata as text: <span itemprop="price">19.99</span>
  const micro = parsePrice(html.match(/itemprop\s*=\s*["']?price["']?(?=[\s>])[^>]*>([^<]+)</i)?.[1]);
  if (micro != null) return done(micro, meta["pricecurrency"], "data");

  // 4. no structured data: read the price off the page
  const shown = shownPrice(html, url);
  return shown && done(shown.price, shown.currency, "guess");
}

// ---------- reading a price off the page ----------

const SYMBOLS = {
  "US$": "USD",
  "C$": "CAD",
  "A$": "AUD",
  "R$": "BRL",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₦": "NGN",
  "₩": "KRW",
  "₺": "TRY",
  "₽": "RUB",
  "₪": "ILS",
  "₫": "VND",
  "฿": "THB",
  zł: "PLN",
  Kč: "CZK",
  Ft: "HUF",
  lei: "RON",
  kr: null, // SEK, NOK or DKK
};
// shops also print the code itself: "PLN 793.01"
const CODES =
  "USD EUR GBP JPY CNY INR PLN CHF SEK NOK DKK CZK HUF RON BGN TRY RUB UAH AUD CAD NZD MXN BRL ARS CLP COP PEN ZAR NGN KES EGP MAD AED SAR ILS KRW TWD HKD SGD MYR THB PHP IDR VND PKR BDT";
const CURRENCY = `(?<![A-Za-z])(?:US\\$|C\\$|A\\$|R\\$|[$€£¥₹₦₩₺₽₪₫฿]|zł|Kč|Ft|lei|kr|${CODES.replaceAll(" ", "|")})(?![A-Za-z])`;
const NUMBER = "\\d{1,3}(?:[ .,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const MONEY = new RegExp(`(${CURRENCY})\\s?(${NUMBER})|(${NUMBER})\\s?(${CURRENCY})`);

// Labelled "price", but not what you pay for the product.
const NOT_THE_PRICE =
  /install|monthly|financ|emi\b|klarna|affirm|afterpay|credit|subscr|old|was|strik|list|original|cross|compare|rrp|msrp|basis|text-price|color-price|saving|save|discount|coupon|badge|ship|deliver|tax|fee|deposit|trade|unit|per-|range|filter|slider|label|total|cart|recommend|related|carousel|sponsor|similar/i;
// A label that names the price you pay.
const THE_PRICE =
  /pricetopay|coreprice|apex|current|sale|final|now|buybox|our-?price|product[-_]?price|price[-_]{1,2}(value|amount|current|final|now|sales?|main)|^price$/i;
// "$33.29/mo", "33,29 € per month", "x 12": a payment plan, not the price.
const PER_PERIOD = /^\s*(\/|per\b|a\b|each\b|every\b|p\.?\s?m\b)?\s*(mo\b|mth|month|wk\b|week|year|yr\b|monthly)|^\s*[x×]\s*\d/i;
const PLAN_BEFORE =
  /(\d+\s*[x×]\s*|payments?\s+of\s*|installments?\s+of\s*|monthly\s*(payment)?:?\s*|deposit:?\s*|save\s*(up to)?\s*|off\s*|shipping:?\s*|delivery:?\s*|was:?\s*|rrp:?\s*|list( price)?:?\s*)$/i;

// ponytail: a guess, used only when a page has no structured data, and
// marked as such ("guess") so a surprising result gets double-checked
// (see record() in items.js). "$" is read as USD.
function shownPrice(html, url) {
  const body = visible(html);
  // Amazon pages are full of other prices (shipping tables, other sellers,
  // payment plans): there, only the main price box counts.
  const strict = url && /(^|\.)amazon\./.test(new URL(url).hostname) ? /coreprice|pricetopay|apex/i : null;
  let fallback = null;
  const labelled =
    /<[a-z0-9]+\b[^>]*\b(?:class|id|data-testid|data-test|data-qa)\s*=\s*["']([^"']*price[^"']*)["'][^>]*>/gi;
  for (const m of body.matchAll(labelled)) {
    const label = m[1];
    if (NOT_THE_PRICE.test(label)) continue;
    const start = m.index + m[0].length;
    const words = text(body.slice(start, start + 600));
    const money = words.match(MONEY);
    if (!money || money.index > 24) continue; // the number has to belong to this element
    if (PER_PERIOD.test(words.slice(money.index + money[0].length, money.index + money[0].length + 20))) continue;
    if (PLAN_BEFORE.test(words.slice(0, money.index))) continue;
    const price = parsePrice(money[2] ?? money[3]);
    if (price == null) continue;
    const found = { price, currency: currencyCode(money[1] ?? money[4]) };
    if (strict ? strict.test(label) : THE_PRICE.test(label)) return found;
    fallback ??= found;
  }
  return strict ? null : fallback;
}

const currencyCode = (token) => (token in SYMBOLS ? SYMBOLS[token] : token);

const visible = (html) => html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, "");
const text = (html) => decode(html.replace(/<[^>]*>/g, " ")) ?? "";

// ---------- pictures ----------

function resolve(link, base) {
  if (typeof link !== "string" || !link.trim()) return null;
  try {
    const u = new URL(decode(link), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null; // relative link and no base to resolve it against
  }
}

function findImage(picture, meta, html, url) {
  // schema.org image: a URL, a list of them, or an ImageObject
  const first = Array.isArray(picture) ? picture[0] : picture;
  const candidates = [
    first && typeof first === "object" ? (first.url ?? first.contentUrl) : first,
    meta["og:image:secure_url"],
    meta["og:image"],
    meta["twitter:image"],
    meta["twitter:image:src"],
    meta["image"],
    attrs(html.match(/<link\b[^>]*rel=["']image_src["'][^>]*>/i)?.[0]).href,
  ];
  // no metadata: the main product photo, by its usual names
  const tag = html.match(
    /<img\b[^>]*\b(?:id|class|data-testid)=["'][^"']*(?:landingImage|product[-_]?image|main[-_]?image|primary[-_]?image|hero[-_]?image|gallery[-_]?image|zoom)[^"']*["'][^>]*>/i,
  )?.[0];
  const img = attrs(tag);
  candidates.push(img["data-old-hires"], img.src, img["data-src"]);
  for (const c of candidates) {
    const link = resolve(c, url);
    if (link && !link.startsWith("data:")) return link;
  }
  return null;
}

function findIcon(html, url) {
  const links = [...html.matchAll(/<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi)].map(([tag]) => attrs(tag));
  // apple-touch-icon is the big one
  const best = links.find((a) => /apple-touch/i.test(a.rel)) ?? links[0];
  return resolve(best?.href, url) ?? (url ? resolve("/favicon.ico", url) : null);
}

// ---------- structured data ----------

function findProduct(node, needOffer) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findProduct(n, needOffer);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if ([node["@type"]].flat().includes("Product")) {
    const offer = findOffer(node.offers);
    if (offer || !needOffer) return { name: node.name, image: node.image, offer };
  }
  return findProduct(Object.values(node), needOffer); // @graph, mainEntity, hasVariant, ...
}

function findOffer(node) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findOffer(n);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  // a payment plan ("24 × 33.29 per month") is not the price
  if (isPlan(node) || [node.priceSpecification].flat().some(isPlan)) return null;
  const price = parsePrice(node.price ?? node.lowPrice);
  if (price != null) {
    const stock = typeof node.availability === "string" ? node.availability : "";
    return { price, currency: node.priceCurrency, available: stock ? !GONE.test(stock) : null };
  }
  const inner = findOffer(node.priceSpecification) ?? findOffer(node.offers);
  return inner && { ...inner, currency: inner.currency ?? node.priceCurrency };
}

/** schema.org's ways of saying "per month": billing fields, MON units, plan names */
function isPlan(node) {
  if (!node || typeof node !== "object") return false;
  if (node.billingDuration != null || node.billingIncrement != null) return true;
  const words = `${node.name ?? ""} ${node.description ?? ""} ${node.unitText ?? ""} ${node.unitCode ?? ""} ${node.referenceQuantity?.unitCode ?? ""}`;
  return /month|\bMON\b|\bANN\b|install|subscri|financ|per\s+(week|year)/i.test(words);
}

function attrs(tag) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of (tag ?? "").matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  }
  return out;
}

/** Every tag with a content attribute, keyed by its property/name/itemprop. */
function metas(html) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [tag] of html.matchAll(/<[a-z][^>]*\scontent\s*=[^>]*>/gi)) {
    const a = attrs(tag);
    for (const key of [a.property, a.name, a.itemprop]) {
      if (key && a.content) out[key.toLowerCase()] ??= a.content;
    }
  }
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", euro: "€", pound: "£", yen: "¥" };

function decode(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  return s
    .replace(/&(#x?[\da-f]+|\w+);/gi, (all, e) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? all;
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    })
    .replace(/\s+/g, " ")
    .trim();
}
