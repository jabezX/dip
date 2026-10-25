// The watched-item shape and the rules for updating it.
// Shared by the web app and the extension, so exports stay interchangeable.

/** @typedef {{ t: number, p: number }} Point */
/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string | null} currency
 * @property {Point[]} history  one point per price change, oldest first
 * @property {number} checkedAt
 * @property {string} [error]   why the last check failed
 */
/** @typedef {{ price: number, currency: string | null, title: string | null }} Found */

const MAX_POINTS = 500;

/** @param {string} url @param {Found} found @returns {Item} */
export function newItem(url, found, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    url,
    title: found.title ?? new URL(url).hostname,
    currency: found.currency,
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
    item: { ...item, currency: found.currency ?? item.currency, history, checkedAt: now, error: undefined },
    previous: changed ? last : null,
  };
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
