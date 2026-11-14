import { extractPrice } from "./core/extract.js";
import { change, formatPrice, isWatched, newItem, TEST_URL, testFound } from "./core/items.js";

const ANY_SHOP = { origins: ["*://*/*"] };

const $ = (id) => document.getElementById(id);
const load = async () => (await chrome.storage.local.get("items")).items ?? [];
const save = (items) => chrome.storage.local.set({ items });
const short = (t) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dateTime = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Tiny createElement helper. Text only: titles come from web pages. */
function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function thumb(item, host) {
  const letter = () => el("span", { className: "thumb letter" }, host[0]?.toUpperCase() ?? "");
  if (!item.image) return letter();
  const img = el("img", { className: "thumb", src: item.image, alt: "", referrerPolicy: "no-referrer" });
  img.onerror = () => img.replaceWith(letter());
  return img;
}

const open = new Set(); // ids of expanded rows, kept across re-renders

function row(item) {
  const host = new URL(item.url).hostname.replace(/^www\./, "");
  const prices = item.history.map((pt) => pt.p);
  const fmt = (p) => formatPrice(p, item.currency);
  const pct = change(item.history);

  const money = el("span", { className: "money" }, fmt(prices.at(-1)));
  if (pct != null) {
    const delta = `${pct < 0 ? "▼" : "▲"} ${Math.abs(pct).toFixed(1)}%`;
    money.append(el("span", { className: `pill ${pct < 0 ? "down" : "up"}` }, delta));
  }

  const summary = el(
    "summary",
    { title: item.title },
    thumb(item, host),
    el(
      "span",
      { className: "what" },
      el("span", {}, item.title),
      el("span", { className: "sub" }, `${host} · checked ${short(item.checkedAt)}`),
      item.error ? el("span", { className: "sub up" }, item.error) : "",
    ),
    money,
  );

  const fact = (label, value) => el("div", {}, el("dt", {}, label), el("dd", {}, value));
  const remove = el("button", { className: "soft danger" }, "Remove");
  remove.onclick = async () => save((await load()).filter((i) => i.id !== item.id));

  const more = el(
    "div",
    { className: "more" },
    el(
      "dl",
      { className: "facts" },
      fact("Lowest", fmt(Math.min(...prices))),
      fact("Highest", fmt(Math.max(...prices))),
      fact("First seen at", fmt(prices[0])),
    ),
    el(
      "ol",
      { className: "history" },
      ...item.history
        .slice(-8)
        .reverse()
        .map((pt) => el("li", {}, el("span", {}, dateTime(pt.t)), el("span", {}, fmt(pt.p)))),
    ),
    el(
      "div",
      { className: "actions" },
      el("a", { className: "soft", href: item.url, target: "_blank" }, "Open page"),
      remove,
    ),
  );

  const details = el("details", { open: open.has(item.id) }, summary, more);
  details.ontoggle = () => (details.open ? open.add(item.id) : open.delete(item.id));
  return el("li", {}, details);
}

/**
 * Background checks can only fetch shops the user has allowed.
 * Must run inside a click handler.
 */
function allow(urls) {
  const origins = [...new Set(urls.filter((u) => u !== TEST_URL).map((u) => `${new URL(u).origin}/*`))];
  return origins.length ? chrome.permissions.request({ origins }).catch(() => false) : true;
}

const prefs = async () => (await chrome.storage.local.get("prefs")).prefs ?? {};
$("suggest").onchange = async (e) => chrome.storage.local.set({ prefs: { ...(await prefs()), suggest: e.target.checked } });

async function render() {
  const items = await load();
  $("suggest").checked = (await prefs()).suggest !== false;
  $("list").replaceChildren(...items.map(row));
  $("try").hidden = isWatched(items, TEST_URL);
  $("allow").hidden = await chrome.permissions.contains(ANY_SHOP);
}
chrome.storage.onChanged.addListener(render);
render();

$("allow").onclick = async () => {
  await chrome.permissions.request(ANY_SHOP).catch(() => false);
  render();
};

// a made-up product whose price changes on every check, to try notifications
$("test").onclick = async () => save([newItem(TEST_URL, testFound()), ...(await load())]);

$("watch").onclick = async () => {
  $("status").textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url ?? "")) throw new Error("Open a product page first");
    const items = await load();
    if (isWatched(items, tab.url)) throw new Error("You're already watching this product");

    // read the page as rendered, so prices filled in by scripts count too
    const [{ result: html }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });
    const found = extractPrice(html);
    if (!found) throw new Error("No price found on this page");
    await save([newItem(tab.url, found), ...items]);
    // asked last: the permission dialog may close the popup
    await allow([tab.url]);
  } catch (e) {
    $("status").textContent = e.message;
  }
};

// the file opens in the web app's Import
$("export").onclick = async () => {
  const blob = new Blob([JSON.stringify(await load(), null, 2)], { type: "application/json" });
  const link = el("a", { href: URL.createObjectURL(blob), download: "dip-export.json" });
  link.click();
  URL.revokeObjectURL(link.href);
};

$("check").onclick = async () => {
  await allow((await load()).map((i) => i.url)); // silent if already granted
  $("check").disabled = true;
  await chrome.runtime.sendMessage("check");
  $("check").disabled = false;
};
