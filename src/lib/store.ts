import { useSyncExternalStore } from "react";
import { DEV_TEST } from "@core/dev";
import {
  DEFAULT_EVERY,
  describeChange,
  failed,
  isDue,
  isItem,
  isWatched,
  newItem,
  record,
  type Found,
  type Item,
} from "@core/items";

// development builds only: a product whose price changes every minute
export const TEST = process.env.NODE_ENV === "production" ? null : DEV_TEST;

// ---------- small saved settings (check interval, list view) ----------

const saved = new Map<string, { raw: string | null; value: unknown }>();
const savedListeners = new Set<() => void>();

/** A JSON object in localStorage, merged over `fallback`. Same object back until it changes. */
function readSaved<T extends object>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  const hit = saved.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value = fallback;
  try {
    if (raw) value = { ...fallback, ...JSON.parse(raw) };
  } catch {}
  saved.set(key, { raw, value });
  return value;
}

export function writeSaved(key: string, value: object) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  savedListeners.forEach((l) => l());
}

function subscribeSaved(listener: () => void) {
  savedListeners.add(listener);
  addEventListener("storage", listener); // other tabs
  return () => {
    savedListeners.delete(listener);
    removeEventListener("storage", listener);
  };
}

/** `fallback` must be a constant: it is also what the server renders. */
export const useSaved = <T extends object>(key: string, fallback: T) =>
  useSyncExternalStore(subscribeSaved, () => readSaved(key, fallback), () => fallback);

export type Every = { n: number; unit: "minutes" | "hours" | "days" | "weeks" | "months" };
const PREFS = "dip:prefs";
export const DEFAULT_PREFS: { every: Every } = { every: DEFAULT_EVERY as Every };

const getEvery = () => readSaved(PREFS, DEFAULT_PREFS).every;
export const usePrefs = () => useSaved(PREFS, DEFAULT_PREFS);
export const setEvery = (every: Every) => writeSaved(PREFS, { every });

/** An error that is the user's heads-up rather than a failure (shown in yellow). */
export const warning = (message: string) => Object.assign(new Error(message), { warn: true });
const lookupError = (data: { error?: string; gone?: boolean; unavailable?: boolean }) =>
  Object.assign(new Error(data.error ?? "Lookup failed"), { gone: data.gone, unavailable: data.unavailable });

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
function ask<T>(message: { dip: string; url?: string; via?: string }, ms: number): Promise<T> {
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
      if (e.data.error) reject(lookupError(e.data));
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

async function lookup(url: string, item?: Item): Promise<Found> {
  if (TEST && url === TEST.url) return TEST.found(item?.history[item.history.length - 1].p);
  // The extension reads the shop from this browser, which works on far more
  // shops than a server does. Without it, fall back to /api/price.
  if (await hasExtension()) return ask<Found>({ dip: "lookup", url, via: item?.via }, 60_000);
  const res = await fetch(`/api/price?url=${encodeURIComponent(url)}`);
  const data = await res.json();
  if (!res.ok) throw lookupError(data);
  return data;
}

export async function addItem(url: string) {
  const duplicate = () => {
    if (isWatched(getItems(), url)) throw warning("Already watching this");
  };
  duplicate();
  const item = newItem(url, await lookup(url));
  duplicate(); // again: the same link may have been added while we were looking
  setItems([item, ...getItems()]);
}

async function notify(item: Item, previous: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const { title, body } = describeChange(item, previous);
  // renotify: a new alert with the same tag pops up again instead of replacing silently
  const options: NotificationOptions & { renotify?: boolean } = {
    body,
    icon: "/icon-192.png",
    tag: item.id,
    renotify: true,
    data: { url: item.url },
  };
  try {
    // Android only allows notifications through a service worker
    const worker = await navigator.serviceWorker?.getRegistration();
    if (worker) await worker.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // the price is in the list either way
  }
}

let checking = false;

/** Re-check prices, one shop request at a time. dueOnly: skip what was checked recently. */
export async function checkItems(dueOnly = false) {
  if (checking || !navigator.onLine) return;
  checking = true;
  try {
    const every = getEvery();
    for (const current of getItems()) {
      const { id, url } = current;
      const test = TEST && url === TEST.url;
      if (dueOnly && !isDue(current, test ? { n: 1, unit: "minutes" } : every)) continue;
      const found = await lookup(url, current).catch((e: Error) => e);
      // re-read: the list may have changed while we were waiting
      setItems(
        getItems().map((i) => {
          if (i.id !== id) return i;
          if (found instanceof Error) return failed(i, found);
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

export function updateItem(id: string, patch: Partial<Item>) {
  setItems(getItems().map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export function removeItem(id: string) {
  setItems(getItems().filter((i) => i.id !== id));
}
