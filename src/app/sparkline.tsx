import type { Point } from "@/lib/items";

const W = 64;
const H = 24;

// A step line: a price holds until the next change.
export function Sparkline({ points }: { points: Point[] }) {
  const prices = points.map((pt) => pt.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const y = (p: number) => (max === min ? H / 2 : 2 + (H - 4) * (1 - (p - min) / (max - min))).toFixed(1);
  const step = W / points.length;
  const d =
    `M0,${y(prices[0])}` +
    prices
      .slice(1)
      .map((p, i) => ` H${((i + 1) * step).toFixed(1)} V${y(p)}`)
      .join("") +
    ` H${W}`;
  const trend = Math.sign(prices[prices.length - 1] - prices[0]);

  return (
    <svg
      className={`spark ${trend < 0 ? "down" : trend > 0 ? "up" : ""}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Change between the last two prices, e.g. "▼ 12.5%". */
export function Delta({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const [prev, last] = points.slice(-2);
  if (!prev.p) return null;
  const pct = ((last.p - prev.p) / prev.p) * 100;
  return (
    <span className={`delta ${pct < 0 ? "down" : "up"}`}>
      {pct < 0 ? "▼" : "▲"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
