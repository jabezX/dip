import { extractPrice } from "./core/extract.js";
import { change, formatPrice, newItem } from "./core/items.js";

const $ = (id) => document.getElementById(id);
const load = async () => (await chrome.storage.local.get("items")).items ?? [];
const save = (items) => chrome.storage.local.set({ items });

/** Tiny createElement helper. Text only: titles come from web pages. */
function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function row(item) {
  const pct = change(item.history);
  const price = el("span", { className: "price" }, formatPrice(item.history.at(-1).p, item.currency));
  if (pct != null) {
    const delta = `${pct < 0 ? "▼" : "▲"} ${Math.abs(pct).toFixed(1)}%`;
    price.append(el("small", { className: pct < 0 ? "down" : "up" }, delta));
  }
  const remove = el("button", { className: "remove", title: "Remove", ariaLabel: `Remove ${item.title}` }, "×");
  remove.onclick = async () => save((await load()).filter((i) => i.id !== item.id));

  return el(
    "li",
    {},
    el(
      "a",
      { className: "what", href: item.url, target: "_blank", title: item.title },
      el("span", {}, item.title),
      el("span", { className: item.error ? "sub up" : "sub" }, item.error ?? new URL(item.url).hostname),
    ),
    price,
    remove,
  );
}

/**
 * Background checks can only fetch shops the user has allowed, one site at a
 * time. Must run inside a click handler.
 */
function allow(urls) {
  const origins = [...new Set(urls.map((u) => `${new URL(u).origin}/*`))];
  return origins.length ? chrome.permissions.request({ origins }).catch(() => false) : true;
}

async function render() {
  $("list").replaceChildren(...(await load()).map(row));
}
chrome.storage.onChanged.addListener(render);
render();

$("watch").onclick = async () => {
  $("status").textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url ?? "")) throw new Error("Open a product page first");
    const items = await load();
    if (items.some((i) => i.url === tab.url)) throw new Error("Already watching this page");

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

$("check").onclick = async () => {
  await allow((await load()).map((i) => i.url)); // silent if already granted
  $("check").disabled = true;
  await chrome.runtime.sendMessage("check");
  $("check").disabled = false;
};
