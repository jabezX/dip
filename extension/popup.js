import { DEV_TEST } from "./core/dev.js";
import { extractPrice, isNotFound, isUnavailable } from "./core/extract.js";
import {
  ago,
  change,
  DEFAULT_EVERY,
  formatPrice,
  isWatched,
  listNames,
  newItem,
  organize,
  status,
  UNITS,
} from "./core/items.js";

// development installs only (see background.js)
const TEST = "update_url" in chrome.runtime.getManifest() ? null : DEV_TEST;
const ANY_SHOP = { origins: ["*://*/*"] };

const $ = (id) => document.getElementById(id);
const get = async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback;
const load = () => get("items", []);
const save = (items) => chrome.storage.local.set({ items });
const getPrefs = () => get("prefs", {});
const setPrefs = async (patch) => chrome.storage.local.set({ prefs: { ...(await getPrefs()), ...patch } });
const host = (url) => new URL(url).hostname.replace(/^www\./, "");
const when = (t) =>
  new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ---------- building blocks ----------

/** Tiny createElement helper. Text only: titles come from web pages. */
function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false && c !== ""));
  return node;
}

const PATHS = {
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 4v6h-6",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M7 10v4M15 16v4",
  plus: "M12 5v14M5 12h14",
  close: "M18 6 6 18M6 6l12 12",
  dots: "M12 12h.01M19 12h.01M5 12h.01",
  open: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  check: "M20 6 9 17l-5-5",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  search: "M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PATHS[name]);
  svg.append(path);
  return svg;
}

/** Product photo, else the shop's icon, else its favicon, else a letter. */
// which picture worked for each product, so a re-render doesn't fetch them again
const pictures = new Map();

function thumb(item, className = "thumb") {
  const letter = () => el("span", { className: `${className} letter` }, host(item.url)[0]?.toUpperCase() ?? "");
  const sources = [...new Set([item.image, item.icon, `${new URL(item.url).origin}/favicon.ico`].filter(Boolean))];
  const key = `${item.id} ${sources.join(" ")}`;
  const known = pictures.get(key);
  if (known === null) return letter();
  const img = el("img", { className, alt: "", referrerPolicy: "no-referrer" });
  const show = (src) => {
    img.classList.toggle("logo", src !== item.image); // icons get padding
    img.src = src;
  };
  if (known) {
    show(known);
    return img;
  }
  let i = 0;
  const next = () => {
    if (i >= sources.length) {
      pictures.set(key, null);
      return img.replaceWith(letter());
    }
    show(sources[i++]);
  };
  img.onerror = next;
  // a 1×1 or broken icon counts as missing
  img.onload = () => (img.naturalWidth < 8 ? next() : pictures.set(key, img.src));
  next();
  return img;
}

const STATUS = { unlisted: ["Unlisted", "bad"], out: ["Unavailable", "warn"], error: ["Check failed", "bad"] };

function badge(item) {
  const st = status(item);
  if (st !== "ok") return el("span", { className: `chip ${STATUS[st][1]}`, title: item.error ?? "" }, STATUS[st][0]);
  const pct = change(item.history);
  if (pct == null) return null;
  return el("span", { className: `chip ${pct < 0 ? "good" : "bad"}` }, `${pct < 0 ? "↓" : "↑"} ${Math.abs(pct).toFixed(1)}%`);
}

// ---------- toast ----------

let toastTimer;
function toast(text, kind = "ok") {
  const t = $("toast");
  t.className = `toast ${kind}`;
  t.replaceChildren(icon(kind === "ok" ? "check" : "alert"), el("span", {}, text));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// ---------- the list ----------

function row(item) {
  const st = status(item);
  const link = el(
    "a",
    { className: "row", href: item.url, target: "_blank", rel: "noreferrer", title: item.title },
    thumb(item),
    el(
      "span",
      { className: "what" },
      el("span", { className: "name" }, item.title),
      el("span", { className: "shop" }, host(item.url), item.list ? el("span", { className: "tag" }, item.list) : null),
      el("span", { className: "when" }, ago(item.checkedAt)),
    ),
    el(
      "span",
      { className: "money" },
      el("span", { className: st === "ok" || st === "error" ? "price" : "price dim" }, formatPrice(item.history.at(-1).p, item.currency)),
      badge(item),
    ),
  );
  const more = el("button", { className: "more", title: "Details", ariaLabel: `Details: ${item.title}` }, icon("dots"));
  more.onclick = () => openDetails(item.id);
  return el("li", {}, link, more);
}

async function render() {
  const [items, view] = await Promise.all([load(), get("view", {})]);
  const options = [
    ["all", "All"],
    ["drops", "Drops"],
    ["out", "Unavailable"],
    ...listNames(items).map((n) => [`list:${n}`, n]),
  ];
  $("show").replaceChildren(...options.map(([value, label]) => el("option", { value }, label)));
  $("show").value = options.some(([v]) => v === view.show) ? view.show : "all";
  $("sort").value = view.sort ?? "added";
  if (document.activeElement !== $("q")) $("q").value = view.q ?? "";

  const shown = organize(items, { q: $("q").value, sort: $("sort").value, show: $("show").value });
  $("list").replaceChildren(...shown.map(row));
  $("tools").hidden = items.length < 2;
  $("empty").hidden = items.length > 0;
  $("none").hidden = !items.length || shown.length > 0;

  // keep an open details sheet in step, unless the user is typing in it
  if (openId && !$("modal").contains(document.activeElement?.closest("input, select") ?? null)) openDetails(openId);
}

const saveView = () =>
  chrome.storage.local.set({ view: { q: $("q").value, sort: $("sort").value, show: $("show").value } });
$("q").oninput = saveView;
$("sort").onchange = saveView;
$("show").onchange = saveView;
chrome.storage.onChanged.addListener(render);

// ---------- modal ----------

let openId = null;

function modal(...children) {
  const close = el("button", { className: "icon close", ariaLabel: "Close" }, icon("close"));
  close.onclick = closeModal;
  $("modal").firstElementChild.replaceChildren(close, ...children.filter(Boolean));
  if ($("modal").hidden) {
    $("modal").hidden = false;
    document.body.classList.add("modal-open");
    close.focus();
  }
}

function closeModal() {
  openId = null;
  $("modal").hidden = true;
  document.body.classList.remove("modal-open");
}

$("modal").onclick = (e) => e.target === $("modal") && closeModal();
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("modal").hidden) {
    e.preventDefault();
    closeModal();
  }
});

function chart(history) {
  const w = 300;
  const h = 64;
  const prices = history.map((pt) => pt.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const y = (p) => (max === min ? h / 2 : 6 + (h - 12) * (1 - (p - min) / (max - min))).toFixed(1);
  const step = w / prices.length;
  const line = `M0,${y(prices[0])}${prices
    .slice(1)
    .map((p, i) => ` H${((i + 1) * step).toFixed(1)} V${y(p)}`)
    .join("")} H${w}`;
  const trend = prices.at(-1) < prices[0] ? "good" : prices.at(-1) > prices[0] ? "bad" : "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", `chart ${trend}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path d="${line} V${h} H0 Z" fill="currentColor" opacity=".12"/>
    <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  return svg;
}

async function openDetails(id) {
  const items = await load();
  const item = items.find((i) => i.id === id);
  if (!item) return closeModal();
  openId = id;
  const fmt = (p) => formatPrice(p, item.currency);
  const prices = item.history.map((pt) => pt.p);
  const fact = (label, value) => el("div", {}, el("dt", {}, label), el("dd", {}, value));

  const list = el("input", { className: "field", value: item.list ?? "", placeholder: "Add to a list…", ariaLabel: "List" });
  list.setAttribute("list", "list-names");
  list.onchange = async () =>
    save((await load()).map((i) => (i.id === id ? { ...i, list: list.value.trim() || undefined } : i)));

  const remove = el("button", { className: "ghost danger" }, icon("trash"), "Remove");
  remove.onclick = async () => {
    closeModal();
    await save((await load()).filter((i) => i.id !== id));
    toast("Removed");
  };

  modal(
    el(
      "div",
      { className: "m-head" },
      thumb(item, "thumb big"),
      el(
        "div",
        { className: "m-what" },
        el("h2", { id: "m-title" }, item.title),
        el("span", { className: "shop" }, host(item.url)),
        el("span", { className: "when" }, `Checked ${ago(item.checkedAt)}`),
      ),
    ),
    el("div", { className: "m-price" }, el("strong", {}, fmt(prices.at(-1))), badge(item)),
    item.pending && el("p", { className: "note" }, `Saw ${fmt(item.pending.p)} once · confirming`),
    prices.length > 1 && chart(item.history),
    el(
      "dl",
      { className: "facts" },
      fact("Low", fmt(Math.min(...prices))),
      fact("High", fmt(Math.max(...prices))),
      fact("Start", fmt(prices[0])),
    ),
    el(
      "ol",
      { className: "history" },
      ...item.history
        .slice(-30)
        .reverse()
        .map((pt) => el("li", {}, el("span", {}, when(pt.t)), el("span", {}, fmt(pt.p)))),
    ),
    el("div", { className: "m-list" }, list, el("datalist", { id: "list-names" }, ...listNames(items).map((value) => el("option", { value })))),
    el(
      "div",
      { className: "m-actions" },
      el("a", { className: "primary", href: item.url, target: "_blank", rel: "noreferrer" }, icon("open"), "Open page"),
      remove,
    ),
  );
}

function toggle(checked, onChange) {
  const box = el("input", { type: "checkbox", className: "switch", checked });
  box.onchange = () => onChange(box.checked, box);
  return box;
}

const setting = (label, hint, control) =>
  el("label", { className: "setting" }, el("span", {}, el("b", {}, label), hint && el("small", {}, hint)), control);

async function openSettings() {
  openId = null;
  const prefs = await getPrefs();
  const every = prefs.every ?? DEFAULT_EVERY;

  const n = el("input", { type: "number", min: 1, max: 999, value: every.n, className: "field num", ariaLabel: "Every" });
  const unit = el(
    "select",
    { className: "field", ariaLabel: "Unit" },
    ...Object.keys(UNITS).map((u) => el("option", { value: u, selected: u === every.unit }, u)),
  );
  const saveEvery = () => {
    n.value = Math.max(1, Math.min(999, Math.round(Number(n.value) || 1)));
    setPrefs({ every: { n: Number(n.value), unit: unit.value } });
  };
  n.onchange = saveEvery;
  unit.onchange = saveEvery;

  const suggest = toggle(prefs.suggest !== false, (on) => setPrefs({ suggest: on }));
  const anyShop = toggle(await chrome.permissions.contains(ANY_SHOP), async (on, box) => {
    const ok = on
      ? await chrome.permissions.request(ANY_SHOP).catch(() => false)
      : await chrome.permissions.remove(ANY_SHOP).catch(() => false);
    if (!ok) box.checked = !on;
  });

  const exportList = el("button", { className: "ghost" }, icon("download"), "Export list");
  exportList.onclick = async () => {
    const blob = new Blob([JSON.stringify(await load(), null, 2)], { type: "application/json" });
    const link = el("a", { href: URL.createObjectURL(blob), download: "dip-export.json" });
    link.click();
    URL.revokeObjectURL(link.href);
  };

  let dev = null;
  if (TEST) {
    const testing = isWatched(await load(), TEST.url);
    const button = el("button", { className: "ghost" }, testing ? "Remove test product" : "Add test product");
    button.onclick = async () => {
      const items = await load();
      await save(
        testing ? items.filter((i) => i.url !== TEST.url) : [newItem(TEST.url, TEST.found()), ...items],
      );
      toast(testing ? "Test product removed" : "Test product added · alerts every minute", "ok");
      openSettings();
    };
    dev = el("div", { className: "dev" }, el("span", { className: "label" }, "Dev build"), button);
  }

  modal(
    el("h2", { id: "m-title" }, "Settings"),
    setting("Check every", null, el("span", { className: "every" }, n, unit)),
    setting("Suggest products", "Offers to watch product pages you open", suggest),
    setting("Any shop", "Lets the Dip web app use this extension", anyShop),
    el("div", { className: "m-actions" }, exportList),
    dev,
  );
}

// ---------- actions ----------

$("check").append(icon("refresh"));
$("settings").append(icon("sliders"));
$("watch").append(icon("plus"), "Watch this page");
$("q").before(icon("search"));
$("settings").onclick = openSettings;

/**
 * Background checks can only fetch shops the extension may read. Silent when
 * already allowed; must run inside a click handler.
 */
function allow(urls) {
  const origins = [...new Set(urls.filter((u) => u !== TEST?.url).map((u) => `${new URL(u).origin}/*`))];
  return origins.length ? chrome.permissions.request({ origins }).catch(() => false) : true;
}

$("watch").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https?:/.test(tab?.url ?? "")) return toast("Open a product page first", "warn");
  const items = await load();
  if (isWatched(items, tab.url)) return toast("Already watching this", "warn");

  // read the page as rendered, so prices filled in by scripts count too
  const [{ result: html } = {}] = await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.outerHTML })
    .catch(() => []);
  const found = html && extractPrice(html, tab.url);
  if (!found) {
    if (!html) return toast("Can't read this page", "error");
    if (isNotFound(html)) return toast("Page not found", "warn");
    if (/cannot be shipped|doesn.t ship to|does not ship to/i.test(html)) return toast("Doesn't ship to you", "warn");
    if (isUnavailable(html)) return toast("This product is unavailable", "warn");
    return toast("No price on this page", "warn");
  }
  const item = newItem(tab.url, found);
  await save([item, ...(await load())]);
  chrome.runtime.sendMessage({ type: "probe", id: item.id }).catch(() => {});
  toast("Watching");
  // asked last: the permission dialog may close the popup
  await allow([tab.url]);
};

$("check").onclick = async () => {
  await allow((await load()).map((i) => i.url));
  $("check").disabled = true;
  await chrome.runtime.sendMessage("check");
  $("check").disabled = false;
  toast("Prices checked");
};

render();
