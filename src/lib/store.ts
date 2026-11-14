import { useSyncExternalStore } from "react";
import {
  describeChange,
  isItem,
  isWatched,
  newItem,
  record,
  TEST_URL,
  testFound,
  type Found,
  type Item,
} from "@core/items";

// ponytail: one localStorage key holds everything. Fine for hundreds of
// items; move to IndexedDB if someone tracks thousands.
const KEY = "dip:items";
const EMPTY: Item[] = [];

let cache: Item[] | null = null;
const listeners = new Set<() => void>();

export function getItems(): Item[] {
  if (!cache) {
    try {
      cache = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      cache = [];
    }
  }
  return cache!;
}

export function setItems(next: Item[]) {
  cache = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  // other tabs
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    listener();
  };
  listeners.add(listener);
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
}

export const useItems = () => useSyncExternalStore(subscribe, getItems, () => EMPTY);

/** Ask the Dip extension something through its content script (extension/bridge.js). */
function ask<T>(message: { dip: string; url?: string }, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const stop = () => {
      clearTimeout(timer);
      removeEventListener("message", onMessage);
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error("The Dip extension didn't answer"));
    }, ms);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.dip !== "result" || e.data.id !== id) return;
      stop();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.found);
    };
    addEventListener("message", onMessage);
    postMessage({ ...message, id }, location.origin);
  });
}

let extension: Promise<boolean> | undefined;

/** Is the extension installed and allowed on this site? Asked once per page load. */
export const hasExtension = () =>
  (extension ??= ask({ dip: "ping" }, 400).then(
    () => true,
    () => false,
  ));

async function lookup(url: string): Promise<Found> {
  if (url === TEST_URL) return testFound();
  // The extension reads the shop from this browser, which works on far more
  // shops than a server does. Without it, fall back to /api/price.
  if (await hasExtension()) return ask<Found>({ dip: "lookup", url }, 60_000);
  const res = await fetch(`/api/price?url=${encodeURIComponent(url)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Lookup failed");
  return data;
}

export async function addItem(url: string) {
  const duplicate = () => {
    if (isWatched(getItems(), url)) throw new Error("You're already watching that product");
  };
  duplicate();
  const item = newItem(url, await lookup(url));
  duplicate(); // again: the same link may have been added while we were looking
  setItems([item, ...getItems()]);
}

async function notify(item: Item, previous: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const { title, body } = describeChange(item, previous);
  const options = { body, icon: "/icon-192.png", tag: item.id, data: { url: item.url } };
  try {
    // Android only allows notifications through a service worker
    const worker = await navigator.serviceWorker?.getRegistration();
    if (worker) await worker.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // the price is in the list either way
  }
}

const STALE = 30 * 60_000;
let checking = false;

/** Re-check prices, one shop request at a time. */
export async function checkItems(onlyStale = false) {
  if (checking || !navigator.onLine) return;
  checking = true;
  try {
    for (const { id, url, checkedAt } of getItems()) {
      if (onlyStale && Date.now() - checkedAt < STALE) continue;
      const found = await lookup(url).catch((e: Error) => e);
      // re-read: the list may have changed while we were waiting
      setItems(
        getItems().map((i) => {
          if (i.id !== id) return i;
          if (found instanceof Error) return { ...i, error: found.message, checkedAt: Date.now() };
          const { item, previous } = record(i, found);
          if (previous != null) notify(item, previous);
          return item;
        }),
      );
    }
  } finally {
    checking = false;
  }
}

/** Merge an export file (from here or from the extension). Returns how many were added. */
export function importItems(json: string) {
  let incoming: unknown;
  try {
    incoming = JSON.parse(json);
  } catch {
    incoming = null;
  }
  if (!Array.isArray(incoming) || !incoming.every(isItem)) throw new Error("That file isn't a Dip export");
  // skip what is already here, and repeats inside the file itself
  const merged = [...getItems()];
  for (const item of incoming as Item[]) if (!isWatched(merged, item.url)) merged.push(item);
  const added = merged.length - getItems().length;
  setItems(merged);
  return added;
}

export function removeItem(id: string) {
  setItems(getItems().filter((i) => i.id !== id));
}
