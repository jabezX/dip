import { useState } from "react";
import { change, formatPrice, type Item } from "@core/items";
import { removeItem } from "@/lib/store";
import { Icon } from "./icons";
import { Chart } from "./sparkline";

const date = (t: number) => new Date(t).toLocaleDateString(undefined, { dateStyle: "medium" });
const dateTime = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Thumb({ item, host }: { item: Item; host: string }) {
  const [broken, setBroken] = useState(false);
  if (!item.image || broken) return <span className="thumb letter">{host[0]?.toUpperCase()}</span>;
  return (
    // a plain <img>: these come from any shop's CDN, straight to the browser
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="thumb"
      src={item.image}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

export function ItemCard({ item }: { item: Item }) {
  const host = new URL(item.url).hostname.replace(/^www\./, "");
  const prices = item.history.map((pt) => pt.p);
  const current = prices[prices.length - 1];
  const pct = change(item.history);
  const money = (p: number) => formatPrice(p, item.currency);

  return (
    <li className="card item">
      <details>
        <summary>
          <Thumb item={item} host={host} />
          <span className="what">
            <span className="title">{item.title}</span>
            <span className="meta">
              {host} · checked {dateTime(item.checkedAt)}
            </span>
            {item.error && <span className="meta bad">{item.error}</span>}
          </span>
          <Chart points={item.history} />
          <span className="money">
            <span className="price">{money(current)}</span>
            {pct == null ? (
              <span className="pill">watching</span>
            ) : (
              <span className={`pill ${pct < 0 ? "down" : "up"}`}>
                {pct < 0 ? "▼" : "▲"} {Math.abs(pct).toFixed(1)}%
              </span>
            )}
          </span>
          <Icon name="chevron" className="chevron" />
        </summary>

        <div className="more">
          <Chart points={item.history} wide />
          <dl className="facts">
            <div>
              <dt>Lowest</dt>
              <dd className="down">{money(Math.min(...prices))}</dd>
            </div>
            <div>
              <dt>Highest</dt>
              <dd>{money(Math.max(...prices))}</dd>
            </div>
            <div>
              <dt>First seen at</dt>
              <dd>{money(prices[0])}</dd>
            </div>
            <div>
              <dt>Watching since</dt>
              <dd>{date(item.history[0].t)}</dd>
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
            <a className="button soft" href={item.url} target="_blank" rel="noreferrer">
              <Icon name="open" size={16} /> Open page
            </a>
            <button className="soft danger" onClick={() => removeItem(item.id)}>
              <Icon name="trash" size={16} /> Remove
            </button>
          </div>
        </div>
      </details>
    </li>
  );
}
