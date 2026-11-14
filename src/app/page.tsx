"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isWatched, listNames, newItem, organize, UNITS } from "@core/items";
import {
  addItem,
  checkItems,
  type Every,
  getItems,
  hasExtension,
  importItems,
  setEvery,
  setItems,
  TEST,
  useItems,
  usePrefs,
  useSaved,
  writeSaved,
} from "@/lib/store";
import { Icon, Logo } from "./icons";
import { ItemCard } from "./item-card";

const noSubscribe = () => () => {};
type Notice = { text: string; kind: "warn" | "bad" | "ok" };
type View = { q: string; sort: string; show: string };
const VIEW = "dip:view";
const DEFAULT_VIEW: View = { q: "", sort: "added", show: "all" };

export default function Home() {
  const items = useItems();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [checking, setChecking] = useState(false);
  const [extension, setExtension] = useState<boolean>();
  const view = useSaved(VIEW, DEFAULT_VIEW);
  const { every } = usePrefs();
  const fileInput = useRef<HTMLInputElement>(null);

  const stored = useSyncExternalStore(
    noSubscribe,
    () => window.Notification?.permission ?? "denied",
    () => "denied" as const,
  );
  const [asked, setAsked] = useState<NotificationPermission>();
  const alerts = asked ?? stored;

  const say = (e: unknown) =>
    setNotice({
      text: e instanceof Error ? e.message : "Something went wrong",
      kind: e instanceof Error && "warn" in e ? "warn" : "bad",
    });

  useEffect(() => {
    // not in dev: a caching worker and hot reload don't get along
    if (process.env.NODE_ENV === "production") navigator.serviceWorker?.register("/sw.js");
    hasExtension().then(setExtension);
  }, []);

  // opened through the share sheet (see share_target in manifest.ts)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shared = `${params.get("url") ?? ""} ${params.get("text") ?? ""}`.match(/https?:\/\/\S+/)?.[0];
    if (!shared) return;
    history.replaceState(null, "", "/");
    addItem(shared).catch(say);
  }, []);

  // ponytail: prices are only re-checked while the app is open. The extension
  // covers background checks; Periodic Background Sync could do it here.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") checkItems(true);
    };
    tick();
    const timer = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const changeView = (patch: Partial<View>) => writeSaved(VIEW, { ...view, ...patch });

  function changeEvery(patch: Partial<Every>) {
    const next = { ...every, ...patch };
    next.n = Math.max(1, Math.min(999, Math.round(Number(next.n) || 1)));
    setEvery(next);
  }

  async function refresh() {
    setChecking(true);
    await checkItems();
    setChecking(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      await addItem(url.trim());
      setUrl("");
    } catch (e) {
      say(e);
    } finally {
      setBusy(false);
    }
  }

  function exportList() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "dip-export.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importList(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (!file) return;
    try {
      const added = importItems(await file.text());
      setNotice({ text: added ? `Imported ${added}` : "Nothing new to import", kind: added ? "ok" : "warn" });
    } catch (e) {
      say(e);
    }
  }

  const testing = TEST && isWatched(items, TEST.url);
  function toggleTest() {
    const test = TEST;
    if (!test) return;
    setItems(testing ? getItems().filter((i) => i.url !== test.url) : [newItem(test.url, test.found()), ...getItems()]);
  }

  // how each item stands against the price it was first seen at
  const drops = items.map((i) => (i.history[i.history.length - 1].p - i.history[0].p) / (i.history[0].p || 1));
  const cheaper = drops.filter((d) => d < 0).length;
  const best = Math.min(0, ...drops);
  const lists = listNames(items) as string[];
  const shown = organize(items, view as Parameters<typeof organize>[1]);

  return (
    <>
      <header className="bar">
        <div className="brand">
          <Logo />
          <span>Dip</span>
        </div>
        <nav>
          {alerts === "default" && (
            <button
              className="icon"
              title="Turn on alerts"
              aria-label="Turn on alerts"
              onClick={async () => setAsked(await Notification.requestPermission())}
            >
              <Icon name="bell" />
            </button>
          )}
          {items.length > 0 && (
            <button className="icon" title="Export" aria-label="Export list" onClick={exportList}>
              <Icon name="download" />
            </button>
          )}
          <button className="icon" title="Import" aria-label="Import list" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importList} />
          {items.length > 0 && (
            <button className="icon" title="Check now" aria-label="Check prices now" onClick={refresh} disabled={checking}>
              <Icon name="refresh" className={checking ? "spin" : undefined} />
            </button>
          )}
        </nav>
      </header>

      <main>
        {items.length === 0 && (
          <section className="hero">
            <h1>
              Know when the
              <br />
              price <em>dips</em>.
            </h1>
            <p>Paste a product link. Dip checks the price and alerts you when it moves.</p>
          </section>
        )}

        {items.length > 0 && (
          <section className="tiles" aria-label="Summary">
            <div className="card tile">
              <span className="label">Watching</span>
              <span className="value">{items.length}</span>
            </div>
            <div className="card tile">
              <span className="label">Cheaper</span>
              <span className={`value ${cheaper ? "down" : ""}`}>{cheaper}</span>
            </div>
            <div className="card tile">
              <span className="label">Best drop</span>
              <span className={`value ${best < 0 ? "down" : ""}`}>
                {best < 0 ? `−${Math.abs(best * 100).toFixed(0)}%` : "—"}
              </span>
            </div>
          </section>
        )}

        <form className="card add" onSubmit={add}>
          <Icon name="link" />
          <input
            type="url"
            required
            placeholder="Paste a product link"
            aria-label="Product link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button disabled={busy}>
            {busy ? <Icon name="refresh" className="spin" /> : <Icon name="plus" />}
            {busy ? "Looking" : "Watch"}
          </button>
        </form>

        {notice && (
          <p className={`notice ${notice.kind}`} role="status">
            <Icon name={notice.kind === "ok" ? "check" : "alert"} size={15} />
            <span>{notice.text}</span>
            <button className="dismiss" aria-label="Dismiss" onClick={() => setNotice(undefined)}>
              <Icon name="close" size={14} />
            </button>
          </p>
        )}
        {extension === false && (
          <p className="notice info">
            <Icon name="bolt" size={15} />
            <span>
              <b>Get the extension</b> for Amazon, eBay and other big shops.
            </span>
          </p>
        )}

        {items.length > 1 && (
          <div className="tools">
            <label className="search">
              <Icon name="search" size={15} />
              <input
                type="search"
                placeholder="Search"
                aria-label="Search"
                value={view.q}
                onChange={(e) => changeView({ q: e.target.value })}
              />
            </label>
            <select aria-label="Show" value={view.show} onChange={(e) => changeView({ show: e.target.value })}>
              <option value="all">All</option>
              <option value="drops">Drops</option>
              <option value="out">Unavailable</option>
              {lists.length > 0 && (
                <optgroup label="Lists">
                  {lists.map((name) => (
                    <option key={name} value={`list:${name}`}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <select aria-label="Sort" value={view.sort} onChange={(e) => changeView({ sort: e.target.value })}>
              <option value="added">Newest</option>
              <option value="drop">Biggest drop</option>
              <option value="price">Price</option>
              <option value="name">Name</option>
              <option value="shop">Shop</option>
              <option value="checked">Checked</option>
            </select>
          </div>
        )}

        {items.length > 0 ? (
          shown.length ? (
            <ul className="list">
              {shown.map((item) => (
                <ItemCard key={item.id} item={item} lists={lists} />
              ))}
            </ul>
          ) : (
            <p className="empty">No matches</p>
          )
        ) : (
          <ol className="steps">
            <li className="card">
              <b>1</b>
              <span>Paste a product link</span>
            </li>
            <li className="card">
              <b>2</b>
              <span>Dip checks the price</span>
            </li>
            <li className="card">
              <b>3</b>
              <span>Get an alert when it moves</span>
            </li>
          </ol>
        )}

        <footer>
          <label className="every">
            Check every
            <input
              type="number"
              min={1}
              max={999}
              aria-label="Every"
              value={every.n}
              onChange={(e) => changeEvery({ n: Number(e.target.value) })}
            />
            <select
              aria-label="Unit"
              value={every.unit}
              onChange={(e) => changeEvery({ unit: e.target.value as Every["unit"] })}
            >
              {Object.keys(UNITS).map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          {TEST && (
            <button className="link dev" onClick={toggleTest}>
              {testing ? "Remove test product" : "Add test product (dev)"}
            </button>
          )}
          <p>Your list stays on this device. No account, no tracking.</p>
        </footer>
      </main>
    </>
  );
}
