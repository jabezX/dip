// Pull a product's price out of raw HTML.
// String-only on purpose: this runs in Node and in an extension service
// worker, and neither has a DOM.

/** @typedef {{ price: number, currency: string | null, title: string | null }} Extracted */

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

/** @param {string} html @returns {Extracted | null} */
export function extractPrice(html) {
  const meta = metas(html);
  const fallbackTitle = meta["og:title"] ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const done = (price, currency, title) => ({
    price,
    currency: typeof currency === "string" && currency ? currency.toUpperCase() : null,
    title: decode(typeof title === "string" && title.trim() ? title : fallbackTitle),
  });

  // 1. schema.org JSON-LD
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const product = findProduct(JSON.parse(m[1]));
      if (product) return done(product.offer.price, product.offer.currency, product.name);
    } catch {
      // malformed JSON-LD is common, keep looking
    }
  }

  // 2. Open Graph / microdata with a content attribute
  const price = parsePrice(meta["product:price:amount"] ?? meta["og:price:amount"] ?? meta["price"]);
  if (price != null) {
    return done(price, meta["product:price:currency"] ?? meta["og:price:currency"] ?? meta["pricecurrency"]);
  }

  // 3. microdata as text: <span itemprop="price">19.99</span>
  const text = parsePrice(html.match(/itemprop\s*=\s*["']?price["']?(?=[\s>])[^>]*>([^<]+)</i)?.[1]);
  return text == null ? null : done(text, meta["pricecurrency"]);
}

function findProduct(node) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findProduct(n);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if ([node["@type"]].flat().includes("Product")) {
    const offer = findOffer(node.offers);
    if (offer) return { name: node.name, offer };
  }
  return findProduct(Object.values(node)); // @graph, mainEntity, hasVariant, ...
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
  const price = parsePrice(node.price ?? node.lowPrice);
  if (price != null) return { price, currency: node.priceCurrency };
  const inner = findOffer(node.priceSpecification) ?? findOffer(node.offers);
  return inner && { ...inner, currency: inner.currency ?? node.priceCurrency };
}

/** Every tag with a content attribute, keyed by its property/name/itemprop. */
function metas(html) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [tag] of html.matchAll(/<[a-z][^>]*\scontent\s*=[^>]*>/gi)) {
    /** @type {Record<string, string>} */
    const a = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
    }
    for (const key of [a.property, a.name, a.itemprop]) {
      if (key && a.content) out[key.toLowerCase()] ??= a.content;
    }
  }
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

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
