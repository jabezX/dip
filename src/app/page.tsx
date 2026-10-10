"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/items";
import { addItem, removeItem, useItems } from "@/lib/store";

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function Home() {
  const items = useItems();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
                    <span className="sub">{new URL(item.url).hostname.replace(/^www\./, "")}</span>
                  </span>
                  <span className="price">
                    {formatPrice(item.history[item.history.length - 1].p, item.currency)}
                  </span>
                </summary>
                <div className="more">
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
