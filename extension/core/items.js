// The watched-item shape and the rules for updating it.
// Shared by the web app and the extension, so exports stay interchangeable.

/** @typedef {{ t: number, p: number }} Point */
/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string | null} currency
 * @property {string | null} [image]  product picture, if the page names one
 * @property {Point[]} history  one point per price change, oldest first
 * @property {number} checkedAt
 * @property {string} [error]   why the last check failed
 */
/** @typedef {{ price: number, currency: string | null, title: string | null, image?: string | null }} Found */

const MAX_POINTS = 500;

// query parameters that say where a click came from, not which product it is
const TRACKING =
  /^(utm_\w+|fbclid|gclid|gclsrc|dclid|msclkid|mc_[ce]id|igshid|_ga|_gl|ref_?|referrer|spm|scm|cmpid|psc|sr|qid|keywords|crid|sprefix|pd_rd_\w+|pf_rd_\w+|content-id|_encoding|linkCode|linkId|ascsubtag|srsltid|trk\w*)$/i;

/**
 * One key per product, however its link was copied: ignores "www.",
 * #fragments, trailing slashes, tracking parameters and parameter order.
 * @param {string} url
 */
export function productKey(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  // Amazon puts the title and a referrer in the path; the ASIN is the product
  const asin = /(^|\.)amazon\./.test(host) && u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/(\w{10})(?:\/|$)/);
  if (asin) return `${host}/dp/${asin[1].toUpperCase()}`;
  const params = [...u.searchParams]
    .filter(([name]) => !TRACKING.test(name))
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join("&");
  return host + u.pathname.replace(/\/+$/, "") + (params && `?${params}`);
}

/** @param {Item[]} items @param {string} url */
export const isWatched = (items, url) => items.some((i) => productKey(i.url) === productKey(url));

/** A made-up product whose price moves on every check, for trying out notifications. */
export const TEST_URL = "https://example.com/dip-test-product";

/** @returns {Found} */
export const testFound = () => ({
  price: Math.round(2000 + Math.random() * 4000) / 100,
  currency: "USD",
  title: "Test product (its price changes on every check)",
  image: null,
});

/** @param {string} url @param {Found} found @returns {Item} */
export function newItem(url, found, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    url,
    title: found.title ?? new URL(url).hostname,
    currency: found.currency,
    image: found.image ?? null,
    history: [{ t: now, p: found.price }],
    checkedAt: now,
  };
}

/**
 * Apply a fresh lookup. `previous` is the old price if it changed, else null.
 * @param {Item} item @param {Found} found
 * @returns {{ item: Item, previous: number | null }}
 */
export function record(item, found, now = Date.now()) {
  const last = item.history[item.history.length - 1].p;
  const changed = found.price !== last;
  const history = changed ? [...item.history, { t: now, p: found.price }].slice(-MAX_POINTS) : item.history;
  return {
    item: {
      ...item,
      currency: found.currency ?? item.currency,
      image: found.image ?? item.image,
      history,
      checkedAt: now,
      error: undefined,
    },
    previous: changed ? last : null,
  };
}

/**
 * Is this a well-formed item? Imported files are untrusted.
 * @param {any} v
 * @returns {v is Item}
 */
export function isItem(v) {
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.url === "string" &&
    /^https?:\/\//i.test(v.url) && // it ends up in an href
    URL.canParse(v.url) &&
    (v.currency === null || typeof v.currency === "string") &&
    (v.image == null || (typeof v.image === "string" && /^https?:\/\//i.test(v.image))) &&
    Number.isFinite(v.checkedAt) &&
    Array.isArray(v.history) &&
    v.history.length > 0 &&
    v.history.every((pt) => pt && Number.isFinite(pt.t) && Number.isFinite(pt.p))
  );
}

/**
 * Percent change between the last two prices, null if there's nothing to compare.
 * @param {Point[]} history
 */
export function change(history) {
  if (history.length < 2) return null;
  const [prev, last] = history.slice(-2);
  return prev.p ? ((last.p - prev.p) / prev.p) * 100 : null;
}

/**
 * Notification text for a price that just moved.
 * @param {Item} item @param {number} previous
 */
export function describeChange(item, previous) {
  const now = item.history[item.history.length - 1].p;
  return {
    title: `${now < previous ? "Price drop" : "Price up"}: ${item.title}`,
    body: `${formatPrice(previous, item.currency)} → ${formatPrice(now, item.currency)}`,
  };
}

/** @param {number} price @param {string | null} currency */
export function formatPrice(price, currency) {
  try {
    return new Intl.NumberFormat(
      undefined,
      currency ? { style: "currency", currency } : { minimumFractionDigits: 2 },
    ).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency}`; // unknown currency code
  }
}
