// "Watch this price?" — a small card shown on product pages of shops Dip has
// access to (the list in manifest.json, plus any shop the user allowed).

import { extractPrice, isProductPage } from "./core/extract.js";
import { formatPrice, isWatched, newItem, productKey } from "./core/items.js";

// shops whose product pages carry no structured data, recognised by address
const PRODUCT_URL = /\/(dp|gp\/product|gp\/aw\/d|itm|ip)\/[\w-]+/;
const MAX_DISMISSED = 300;

const read = async () => {
  const { items = [], prefs = {} } = await chrome.storage.local.get(["items", "prefs"]);
  return { items, prefs };
};

// ponytail: runs when a page finishes loading. Shops that swap products
// without a page load (single-page apps) need webNavigation history events.
export async function suggest(tabId, url) {
  const { items, prefs } = await read();
  if (prefs.suggest === false) return;
  if (prefs.muted?.includes(new URL(url).hostname)) return;
  if (prefs.dismissed?.includes(productKey(url)) || isWatched(items, url)) return;

  const [{ result: html } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.documentElement.outerHTML,
  });
  if (!html || !(isProductPage(html) || PRODUCT_URL.test(url))) return;
  const found = extractPrice(html, url);
  if (!found) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    func: showSuggestion,
    args: [{ url, found, price: formatPrice(found.price, found.currency) }],
  });
}

/** The card's buttons report back here. Returns the id of a newly watched product. */
export async function answer({ answer, url, found }) {
  const { items, prefs } = await read();
  if (answer === "watch") {
    if (isWatched(items, url)) return null;
    const item = newItem(url, found);
    await chrome.storage.local.set({ items: [item, ...items] });
    return item.id;
  } else if (answer === "mute") {
    await chrome.storage.local.set({ prefs: { ...prefs, muted: [...(prefs.muted ?? []), new URL(url).hostname] } });
  } else {
    const dismissed = [...(prefs.dismissed ?? []), productKey(url)].slice(-MAX_DISMISSED);
    await chrome.storage.local.set({ prefs: { ...prefs, dismissed } });
  }
}

// Injected into the shop page, so it must be self-contained. Lives in a
// closed shadow root: the page's styles don't leak in, ours don't leak out.
function showSuggestion({ url, found, price }) {
  if (document.getElementById("dip-suggestion")) return;
  const host = document.createElement("div");
  host.id = "dip-suggestion";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        position: fixed; z-index: 2147483647; top: 16px; right: 16px; width: 320px;
        padding: 14px; border-radius: 16px; background: #151518; color: #f4f4f6;
        border: 1px solid #2c2c33; box-shadow: 0 18px 50px rgba(0, 0, 0, .35);
        font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        animation: in .25s ease-out;
      }
      @keyframes in { from { opacity: 0; transform: translateY(-8px); } }
      @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
      .top { display: flex; align-items: center; gap: 8px; font-weight: 700; }
      .top svg { border-radius: 6px; }
      .close { margin-left: auto; padding: 2px 6px; background: none; color: #9395a1; font-size: 16px; }
      .title { margin-top: 10px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
      .price { margin-top: 2px; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .row { display: flex; gap: 8px; margin-top: 12px; }
      button { border: 0; border-radius: 10px; padding: 8px 12px; font: inherit; font-weight: 600; cursor: pointer; }
      .watch { flex: 1; background: #30d158; color: #06240f; }
      .later { background: #26262c; color: #f4f4f6; }
      .mute { margin-top: 8px; padding: 0; background: none; color: #9395a1; font-size: 12px; font-weight: 400; }
      button:focus-visible { outline: 2px solid #30d158; outline-offset: 2px; }
    </style>
    <div class="card" role="dialog" aria-label="Dip: watch this price?">
      <div class="top">
        <svg width="22" height="22" viewBox="0 0 512 512" aria-hidden="true">
          <rect width="512" height="512" rx="112" fill="#000"/>
          <polyline points="112,184 216,288 288,216 384,312" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="384" cy="312" r="36" fill="#30d158"/>
        </svg>
        Watch this price?
        <button class="close" data-answer="later" aria-label="Not now">×</button>
      </div>
      <div class="title"></div>
      <div class="price"></div>
      <div class="row">
        <button class="watch" data-answer="watch">Watch with Dip</button>
        <button class="later" data-answer="later">Not now</button>
      </div>
      <button class="mute" data-answer="mute">Don't ask on this site</button>
    </div>`;
  // as text, never as HTML: the title comes from the page
  root.querySelector(".title").textContent = found.title ?? "";
  root.querySelector(".price").textContent = price;
  root.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-answer]")?.dataset.answer;
    if (!choice) return;
    chrome.runtime.sendMessage({ type: "suggestion", answer: choice, url, found });
    host.remove();
  });
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 20_000); // ignored: goes away, asks again next visit
}
