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
 * @property {string | null} [icon]   the shop's icon, shown when there is no picture
 * @property {Point[]} history        one point per price change, oldest first
 * @property {number} checkedAt
 * @property {string} [error]         why the last check failed
 * @property {boolean} [available]    false: the shop says it can't be bought right now
 * @property {boolean} [gone]         the product page no longer exists
 * @property {"data" | "guess"} [source]  how the price was read (see extract.js)
 * @property {Point} [pending]        a surprising price, waiting to be seen a second time
 * @property {string} [list]          the user's own grouping
 */
/**
 * @typedef {object} Found
 * @property {number} price
 * @property {string | null} currency
 * @property {string | null} title
 * @property {string | null} [image]
 * @property {string | null} [icon]
 * @property {boolean | null} [available]
 * @property {"data" | "guess"} [source]
 */

const MAX_POINTS = 500;
// A drop this deep is more often a misread (a monthly instalment, another
// product's price) than a real sale, so it has to be seen twice.
const SUSPICIOUS_DROP = 0.6;

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

/** @param {string} url @param {Found} found @returns {Item} */
export function newItem(url, found, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    url,
    title: found.title ?? new URL(url).hostname,
    currency: found.currency,
    image: found.image ?? null,
    icon: found.icon ?? null,
    available: found.available === false ? false : undefined,
    source: found.source,
    history: [{ t: now, p: found.price }],
    checkedAt: now,
  };
}

/**
 * Apply a fresh lookup. `previous` is the old price if a change was recorded,
 * else null.
 *
 * A change is not taken at face value when it looks like a misread: a very
 * deep drop, or a price that had to be guessed for an item that used to have
 * structured data. It is parked in `pending` and only recorded if the next
 * check sees the same price again.
 * @param {Item} item @param {Found} found
 * @returns {{ item: Item, previous: number | null }}
 */
export function record(item, found, now = Date.now()) {
  const last = item.history[item.history.length - 1].p;
  let { history } = item;
  let previous = null;
  let pending;
  if (found.price !== last) {
    const suspicious =
      found.price < last * SUSPICIOUS_DROP || (item.source === "data" && found.source === "guess");
    if (suspicious && item.pending?.p !== found.price) {
      pending = { t: now, p: found.price };
    } else {
      history = [...history, { t: now, p: found.price }].slice(-MAX_POINTS);
      previous = last;
    }
  }
  return {
    item: {
      ...item,
      currency: found.currency ?? item.currency,
      image: found.image ?? item.image,
      icon: found.icon ?? item.icon,
      source: pending ? item.source : (found.source ?? item.source),
      available: found.available === false ? false : undefined,
      gone: undefined,
      error: undefined,
      pending,
      history,
      checkedAt: now,
    },
    previous,
  };
}

/**
 * Apply a failed lookup. The error may carry `gone` (the page no longer
 * exists) or `unavailable` (the page is there, the product can't be bought).
 * @param {Item} item
 * @param {{ message: string, gone?: boolean, unavailable?: boolean }} error
 * @returns {Item}
 */
export function failed(item, error, now = Date.now()) {
  if (error.gone) return { ...item, gone: true, error: undefined, checkedAt: now };
  if (error.unavailable) return { ...item, available: false, gone: undefined, error: undefined, checkedAt: now };
  return { ...item, error: error.message, checkedAt: now };
}

/** "unlisted" | "out" | "error" | "ok" @param {Item} item */
export const status = (item) =>
  item.gone ? "unlisted" : item.available === false ? "out" : item.error ? "error" : "ok";

/**
 * Is this a well-formed item? Imported files are untrusted.
 * @param {any} v
 * @returns {v is Item}
 */
export function isItem(v) {
  const link = (s) => s == null || (typeof s === "string" && /^https?:\/\//i.test(s));
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.url === "string" &&
    /^https?:\/\//i.test(v.url) && // it ends up in an href
    URL.canParse(v.url) &&
    (v.currency === null || typeof v.currency === "string") &&
    link(v.image) &&
    link(v.icon) &&
    (v.list == null || typeof v.list === "string") &&
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

const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** "2 hours ago", "7 days ago", "1 month ago" @param {number} t */
export function ago(t, now = Date.now()) {
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return relative.format(-days, "day");
  if (days < 365) return relative.format(-Math.floor(days / 30), "month");
  return relative.format(-Math.floor(days / 365), "year");
}

// ---------- how often to check ----------

export const UNITS = { minutes: 1, hours: 60, days: 1440, weeks: 10_080, months: 43_200 };
export const DEFAULT_EVERY = { n: 1, unit: "hours" };

/** @param {{ n?: number, unit?: string } | undefined} every @returns {number} minutes, at least 1 */
export function everyMinutes(every) {
  const n = Number(every?.n);
  const unit = UNITS[every?.unit];
  if (!(n > 0) || !unit) return everyMinutes(DEFAULT_EVERY);
  return Math.max(1, Math.round(n * unit));
}

/** Is it time to check this item again? @param {Item} item */
export const isDue = (item, every, now = Date.now()) => now - item.checkedAt >= everyMinutes(every) * 60_000 * 0.95;

// ---------- organising a long list ----------

const first = (i) => i.history[0].p;
const current = (i) => i.history[i.history.length - 1].p;
const sinceFirst = (i) => (first(i) ? (current(i) - first(i)) / first(i) : 0);
const shop = (i) => new URL(i.url).hostname.replace(/^www\./, "");

const SORTS = {
  added: null, // as stored: newest first
  drop: (a, b) => sinceFirst(a) - sinceFirst(b),
  price: (a, b) => current(a) - current(b),
  name: (a, b) => a.title.localeCompare(b.title),
  shop: (a, b) => shop(a).localeCompare(shop(b)) || a.title.localeCompare(b.title),
  checked: (a, b) => b.checkedAt - a.checkedAt,
};

/** The user's list names, sorted. @param {Item[]} items */
export const listNames = (items) => [...new Set(items.map((i) => i.list).filter(Boolean))].sort();

/**
 * Search, filter and sort for display.
 * `show`: "all" | "drops" | "out" | "list:<name>".
 * @param {Item[]} items
 * @param {{ q?: string, sort?: keyof typeof SORTS, show?: string }} view
 */
export function organize(items, { q = "", sort = "added", show = "all" } = {}) {
  const needle = q.trim().toLowerCase();
  const kept = items.filter((i) => {
    if (needle && !`${i.title} ${shop(i)} ${i.list ?? ""}`.toLowerCase().includes(needle)) return false;
    if (show === "drops") return current(i) < first(i);
    if (show === "out") return status(i) === "out" || status(i) === "unlisted";
    if (show.startsWith("list:")) return i.list === show.slice(5);
    return true;
  });
  return SORTS[sort] ? kept.sort(SORTS[sort]) : kept;
}
