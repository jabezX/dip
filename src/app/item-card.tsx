import { useState } from "react";
import { ago, change, formatPrice, status, type Item } from "@core/items";
import { removeItem, updateItem } from "@/lib/store";
import { Icon } from "./icons";
import { Chart } from "./sparkline";

const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
const dateTime = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const STATUS = {
  unlisted: ["Unlisted", "bad"],
  out: ["Unavailable", "warn"],
  error: ["Check failed", "bad"],
} as const;

/** Product photo, else the shop's icon, else its favicon, else a letter. */
function Thumb({ item }: { item: Item }) {
  const sources = [item.image, item.icon, `${new URL(item.url).origin}/favicon.ico`].filter(Boolean) as string[];
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return <span className="thumb letter">{host(item.url)[0]?.toUpperCase()}</span>;
  const logo = sources[index] !== item.image;
  return (
    // a plain <img>: these come from any shop's CDN, straight to the browser
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={logo ? "thumb logo" : "thumb"}
      src={sources[index]}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setIndex(index + 1)}
      onLoad={(e) => e.currentTarget.naturalWidth < 8 && setIndex(index + 1)}
    />
  );
}

export function Badge({ item }: { item: Item }) {
  const st = status(item);
  if (st !== "ok") {
    const [label, tone] = STATUS[st];
    return (
      <span className={`pill ${tone}`} title={item.error}>
        {label}
      </span>
    );
  }
  const pct = change(item.history);
  if (pct == null) return null;
  return (
    <span className={`pill ${pct < 0 ? "down" : "up"}`}>
      {pct < 0 ? "↓" : "↑"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function ItemCard({ item, lists }: { item: Item; lists: string[] }) {
  const prices = item.history.map((pt) => pt.p);
  const money = (p: number) => formatPrice(p, item.currency);
  const st = status(item);

  return (
    <li className="card item">
      {/* name="items": opening one card closes the others */}
      <details name="items">
        <summary>
          <Thumb item={item} />
          <span className="what">
            <a className="title" href={item.url} target="_blank" rel="noreferrer" title={item.title}>
              {item.title}
            </a>
            <span className="meta">
              {host(item.url)}
              {item.list && <span className="tag">{item.list}</span>}
            </span>
            <span className="when">{ago(item.checkedAt)}</span>
          </span>
          <Chart points={item.history} />
          <span className="money">
            <span className={st === "out" || st === "unlisted" ? "price dim" : "price"}>
              {money(prices[prices.length - 1])}
            </span>
            <Badge item={item} />
          </span>
          <Icon name="chevron" className="chevron" />
        </summary>

        <div className="more">
          {prices.length > 1 && <Chart points={item.history} wide />}
          {item.pending && <p className="note">Saw {money(item.pending.p)} once · confirming</p>}
          <dl className="facts">
            <div>
              <dt>Low</dt>
              <dd className="down">{money(Math.min(...prices))}</dd>
            </div>
            <div>
              <dt>High</dt>
              <dd>{money(Math.max(...prices))}</dd>
            </div>
            <div>
              <dt>Start</dt>
              <dd>{money(prices[0])}</dd>
            </div>
            <div>
              <dt>Checked</dt>
              <dd>{ago(item.checkedAt)}</dd>
            </div>
          </dl>
          <ol className="history">
            {[...item.history].reverse().map((pt) => (
              <li key={pt.t}>
                <span>{dateTime(pt.t)}</span>
                <span>{money(pt.p)}</span>
              </li>
            ))}
          </ol>
          <div className="actions">
            <input
              className="field"
              list="list-names"
              defaultValue={item.list ?? ""}
              placeholder="Add to a list…"
              aria-label="List"
              onBlur={(e) => updateItem(item.id, { list: e.target.value.trim() || undefined })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <datalist id="list-names">
              {lists.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <a className="button soft" href={item.url} target="_blank" rel="noreferrer">
              <Icon name="open" size={15} /> Open
            </a>
            <button className="soft danger" onClick={() => removeItem(item.id)}>
              <Icon name="trash" size={15} /> Remove
            </button>
          </div>
        </div>
      </details>
    </li>
  );
}
