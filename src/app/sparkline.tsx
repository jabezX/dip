import type { Point } from "@core/items";

// A step line: a price holds until the next change.
function stepPath(prices: number[], w: number, h: number, pad: number) {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const y = (p: number) => (max === min ? h / 2 : pad + (h - 2 * pad) * (1 - (p - min) / (max - min))).toFixed(1);
  const step = w / prices.length;
  return (
    `M0,${y(prices[0])}` +
    prices
      .slice(1)
      .map((p, i) => ` H${((i + 1) * step).toFixed(1)} V${y(p)}`)
      .join("") +
    ` H${w}`
  );
}

/** Green when it's cheaper than when you started watching, red when dearer. */
export const trend = (points: Point[]) => {
  const diff = points[points.length - 1].p - points[0].p;
  return diff < 0 ? "down" : diff > 0 ? "up" : "";
};

/**
 * Price over time. Small in a row, or `wide` to fill the card.
 */
export function Chart({ points, wide = false }: { points: Point[]; wide?: boolean }) {
  const [w, h] = wide ? [600, 120] : [88, 32];
  const line = stepPath(
    points.map((pt) => pt.p),
    w,
    h,
    wide ? 10 : 4,
  );
  return (
    <svg
      className={`chart ${wide ? "wide" : ""} ${trend(points)}`}
      width={wide ? "100%" : w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={`${line} V${h} H0 Z`} fill="currentColor" opacity="0.12" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
