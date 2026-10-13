"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/items";
import { addItem, checkItems, removeItem, useItems } from "@/lib/store";
import { Delta, Sparkline } from "./sparkline";

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function Home() {
  const items = useItems();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [checking, setChecking] = useState(false);

  // ponytail: prices are only re-checked while the app is open. The extension
  // covers background checks; Periodic Background Sync could do it here.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") checkItems(true);
    };
    tick();
    const timer = setInterval(tick, 5 * 60_000);
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

  return (
    <main>
      <header>
        <h1>Dip</h1>
        {items.length > 0 && (
          <button className="plain" onClick={refresh} disabled={checking}>
            {checking ? "Checking…" : "Refresh"}
          </button>
        )}
      </header>

      <form onSubmit={add}>
        <input
          type="url"
          required
          placeholder="Paste a product link"
          aria-label="Product link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button disabled={busy}>{busy ? "Adding…" : "Watch"}</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="empty">Nothing here yet. Paste a product link to start watching its price.</p>
      ) : (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id}>
              <details>
                <summary>
                  <span className="what">
                    <span className="title">{item.title}</span>
                    <span className={item.error ? "sub up" : "sub"}>
                      {item.error ?? new URL(item.url).hostname.replace(/^www\./, "")}
                    </span>
                  </span>
                  <Sparkline points={item.history} />
                  <span className="price">
                    {formatPrice(item.history[item.history.length - 1].p, item.currency)}
                    <Delta points={item.history} />
                  </span>
                </summary>
                <div className="more">
                  <ol className="history">
                    {[...item.history].reverse().map((pt) => (
                      <li key={pt.t}>
                        <span>{when(pt.t)}</span>
                        <span>{formatPrice(pt.p, item.currency)}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="sub">Checked {when(item.checkedAt)}</p>
                  <div className="actions">
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Open page
                    </a>
                    <button className="danger" onClick={() => removeItem(item.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
