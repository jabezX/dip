import { useSyncExternalStore } from "react";
import { newItem, record, type Found, type Item } from "./items";

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

async function lookup(url: string): Promise<Found> {
  const res = await fetch(`/api/price?url=${encodeURIComponent(url)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Lookup failed");
  return data;
}

export async function addItem(url: string) {
  if (getItems().some((i) => i.url === url)) throw new Error("You're already watching that link");
  const item = newItem(url, await lookup(url));
  setItems([item, ...getItems()]);
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
          return record(i, found).item;
        }),
      );
    }
  } finally {
    checking = false;
  }
}

export function removeItem(id: string) {
  setItems(getItems().filter((i) => i.id !== id));
}
