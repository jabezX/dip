"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isWatched, TEST_URL } from "@core/items";
import { addItem, checkItems, hasExtension, importItems, useItems } from "@/lib/store";
import { Icon, Logo } from "./icons";
import { ItemCard } from "./item-card";

const noSubscribe = () => () => {};

export default function Home() {
  const items = useItems();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [extension, setExtension] = useState<boolean>();
  const fileInput = useRef<HTMLInputElement>(null);

  const stored = useSyncExternalStore(
    noSubscribe,
    () => window.Notification?.permission ?? "denied",
    () => "denied" as const,
  );
  const [asked, setAsked] = useState<NotificationPermission>();
  const alerts = asked ?? stored;

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
    addItem(shared).catch((e: Error) => setError(e.message));
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

  async function refresh() {
    setChecking(true);
    await checkItems();
    setChecking(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await addItem(url.trim());
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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
      importItems(await file.text());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  // how each item stands against the price it was first seen at
  const drops = items.map((i) => (i.history[i.history.length - 1].p - i.history[0].p) / (i.history[0].p || 1));
  const cheaper = drops.filter((d) => d < 0).length;
  const best = Math.min(0, ...drops);

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
              title="Turn on price alerts"
              aria-label="Turn on price alerts"
              onClick={async () => setAsked(await Notification.requestPermission())}
            >
              <Icon name="bell" />
            </button>
          )}
          {items.length > 0 && (
            <button className="icon" title="Export list" aria-label="Export list" onClick={exportList}>
              <Icon name="download" />
            </button>
          )}
          <button
            className="icon"
            title="Import list"
            aria-label="Import list"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" />
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importList} />
          {items.length > 0 && (
            <button
              className="icon"
              title="Check prices now"
              aria-label="Check prices now"
              onClick={refresh}
              disabled={checking}
            >
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
            <p>Paste a product link. Dip remembers the price, keeps checking, and tells you the moment it moves.</p>
          </section>
        )}

        {items.length > 0 && (
          <section className="tiles" aria-label="Summary">
            <div className="card tile">
              <span className="label">Watching</span>
              <span className="value">{items.length}</span>
            </div>
            <div className="card tile">
              <span className="label">Cheaper now</span>
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

        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}
        {extension === false && (
          <p className="notice">
            <Icon name="bolt" size={16} />
            <span>
              <b>Works best with the Dip extension.</b> Amazon, eBay and many big shops only show prices to a real
              browser. With the extension installed, lookups run in yours.
            </span>
          </p>
        )}

        {items.length > 0 ? (
          <ul className="list">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <ol className="steps">
            <li className="card">
              <b>1</b>
              <span>Paste a link to any product page</span>
            </li>
            <li className="card">
              <b>2</b>
              <span>Dip records the price and re-checks it</span>
            </li>
            <li className="card">
              <b>3</b>
              <span>You get an alert when it changes</span>
            </li>
          </ol>
        )}

        {!isWatched(items, TEST_URL) && (
          <p className="try">
            Want to see an alert?{" "}
            <button className="link" onClick={() => addItem(TEST_URL)}>
              Add a test product
            </button>{" "}
            whose price changes on every check, then press refresh.
          </p>
        )}

        <footer>Your list and price history stay on this device. No account, no tracking.</footer>
      </main>
    </>
  );
}
