"use client";

/**
 * Small SVG charts for the analytics page.
 * Palette validated for the dark surface (all pairs, incl. colour-blind checks):
 * gold #c98500, violet #8b5cf6, cyan #1597b4. Text never uses series colours.
 */

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

export const SERIES = { gold: "#c98500", violet: "#8b5cf6", cyan: "#1597b4" };
const GRID = "rgba(255,255,255,0.07)";

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean axis maximum and 3-4 ticks. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks;
}

export const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x, 90), width - 90);
  return (
    <div className="pointer-events-none absolute z-10 w-max -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-white/10 bg-[#15151d]/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
      style={{ left, top: y - 10 }}>
      {children}
    </div>
  );
}

const PAD = { top: 16, right: 16, bottom: 26, left: 52 };

// ------------------------------------------------------------ columns (one series)

export function ColumnChart({ data, color, format, label, height = 220 }: {
  data: { date: string; value: number }[]; color: string; format: (v: number) => string; label: string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const innerW = Math.max(width - PAD.left - PAD.right, 0);
  const innerH = height - PAD.top - PAD.bottom;
  const slot = data.length ? innerW / data.length : 0;
  const barW = Math.max(Math.min(24, slot - 2), 2);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const labelEvery = Math.ceil(data.length / 6);

  return (
    <div ref={ref} className="relative" role="img" aria-label={label}>
      {width > 0 && (
        <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[#8b8a9b] text-[11px]">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const h = (d.value / top) * innerH;
            const r = Math.min(4, h / 2, barW / 2);
            const x0 = cx - barW / 2, yb = PAD.top + innerH;
            // 4px rounded data-end, square at the baseline
            const path = h <= 0 ? "" :
              `M${x0},${yb} V${yb - h + r} Q${x0},${yb - h} ${x0 + r},${yb - h} H${x0 + barW - r} Q${x0 + barW},${yb - h} ${x0 + barW},${yb - h + r} V${yb} Z`;
            return (
              <g key={d.date}>
                {path && (
                  <motion.path d={path} fill={color} opacity={hover === null || hover === i ? 1 : 0.45}
                    initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} style={{ transformOrigin: `${cx}px ${yb}px` }}
                    transition={{ duration: 0.5, delay: i * 0.012, ease: [0.2, 0.8, 0.2, 1] }} />
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-[#8b8a9b] text-[11px]">{shortDate(d.date)}</text>
                )}
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent"
                  onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.18)" />
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={PAD.left + slot * hover + slot / 2} y={y(data[hover].value)} width={width}>
          <div className="text-muted">{shortDate(data[hover].date)}</div>
          <div className="mt-0.5 flex items-center gap-2 font-medium text-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />{format(data[hover].value)}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// ------------------------------------------------------------ lines (few series, same unit)

export type LineSeries = { key: string; name: string; color: string; values: (number | null)[] };

export function LineChart({ dates, series, format, label, height = 240 }: {
  dates: string[]; series: LineSeries[]; format: (v: number) => string; label: string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const right = 92; // room for direct end labels
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const innerW = Math.max(width - PAD.left - right, 0);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (dates.length > 1 ? (i / (dates.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const labelEvery = Math.ceil(dates.length / 6);

  const pathOf = (vals: (number | null)[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const lastIdx = (vals: (number | null)[]) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return i; return -1; };

  // end labels: keep them apart by at least 14px, ordered by value
  const ends = series.map((s) => ({ s, i: lastIdx(s.values) })).filter((e) => e.i >= 0)
    .map((e) => ({ ...e, ly: y(e.s.values[e.i]!) })).sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 14) ends[k].ly = ends[k - 1].ly + 14;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / Math.max(rect.width, 1);
    setHover(Math.round(rel * (dates.length - 1)));
  };

  return (
    <div ref={ref} className="relative" role="img" aria-label={label}>
      {width > 0 && (
        <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[#8b8a9b] text-[11px]">{format(t)}</text>
            </g>
          ))}
          {dates.map((d, i) => i % labelEvery === 0 && (
            <text key={d} x={x(i)} y={height - 6} textAnchor="middle" className="fill-[#8b8a9b] text-[11px]">{shortDate(d)}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.25)" />}
          {series.map((s, si) => (
            <g key={s.key}>
              <motion.path d={pathOf(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: si * 0.15, ease: "easeOut" }} />
              {/* isolated points (a day between two empty days) still need a visible mark */}
              {s.values.map((v, i) => v !== null && (s.values[i - 1] ?? null) === null && (s.values[i + 1] ?? null) === null && (
                <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke="#0f0f14" strokeWidth={2} />
              ))}
              {hover !== null && s.values[hover] !== null && (
                <circle cx={x(hover)} cy={y(s.values[hover]!)} r={5} fill={s.color} stroke="#0f0f14" strokeWidth={2} />
              )}
            </g>
          ))}
          {ends.map(({ s, i, ly }) => (
            <g key={s.key}>
              <circle cx={x(i)} cy={y(s.values[i]!)} r={4} fill={s.color} stroke="#0f0f14" strokeWidth={2} />
              <text x={PAD.left + innerW + 10} y={ly} dy="0.32em" className="fill-[#c9c8d4] text-[11px]">{s.name}</text>
            </g>
          ))}
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} />
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={x(hover)} y={PAD.top + 8} width={width}>
          <div className="text-muted">{shortDate(dates[hover])}</div>
          {series.map((s) => (
            <div key={s.key} className="mt-0.5 flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-foreground/80"><span className="h-0.5 w-3 rounded" style={{ background: s.color }} />{s.name}</span>
              <span className="font-medium text-foreground">{s.values[hover] === null ? "—" : format(s.values[hover]!)}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm text-muted">
      {items.map((it) => (
        <span key={it.name} className="flex items-center gap-2"><span className="h-0.5 w-4 rounded" style={{ background: it.color }} />{it.name}</span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ sparkline + horizontal bars

/** `null` = no data that day (e.g. no answers, so no response time): skipped, not drawn as zero. */
export function Sparkline({ values, color = SERIES.gold }: { values: (number | null)[]; color?: string }) {
  const w = 96, h = 28;
  const max = Math.max(...values.map((v) => v ?? 0), 1e-9);
  const pts = values.map((v, i) => v === null ? null : [(i / Math.max(values.length - 1, 1)) * (w - 4) + 2, h - 3 - (v / max) * (h - 6)] as const);
  let d = "", pen = false;
  for (const pt of pts) {
    if (!pt) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)} `;
    pen = true;
  }
  const last = [...pts].reverse().find((pt) => pt !== null);
  return (
    <svg width={w} height={h} aria-hidden className="overflow-visible">
      <motion.path d={d} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
      {last && <circle cx={last[0]} cy={last[1]} r={3} fill={color} />}
    </svg>
  );
}

export function BarList({ rows, color = SERIES.gold, format = (v: number) => v.toLocaleString() }: {
  rows: { label: string; value: number; note?: string }[]; color?: string; format?: (v: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <li key={r.label} className="group">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{format(r.value)}{r.note && <span className="ms-2 text-xs">{r.note}</span>}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
            <motion.div className="h-full rounded-full" style={{ background: color }}
              initial={{ width: 0 }} animate={{ width: `${(r.value / max) * 100}%` }}
              transition={{ duration: 0.7, delay: 0.1 + i * 0.05, ease: [0.2, 0.8, 0.2, 1] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
