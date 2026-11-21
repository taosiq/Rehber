"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BookCheck, Bot, CheckCircle2, CircleDollarSign, ExternalLink,
  FlaskConical, Gauge, Globe2, Languages, Loader2, MessagesSquare, Quote, Radio, Table2, Timer, Wrench, XCircle, Zap,
} from "lucide-react";
import { useTenant } from "@/components/dashboard/TenantContext";
import { BarList, ColumnChart, Legend, LineChart, SERIES, Sparkline, shortDate } from "@/components/analytics/charts";
import { analyticsApi, type Analytics, type EvalReport, type Overview } from "@/lib/api";

// ------------------------------------------------------------ formatting

const fmtMs = (v: number | null | undefined) =>
  v == null ? "—" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(v < 10000 ? 1 : 0)} s`;
const fmtUsd = (v: number) =>
  v === 0 ? "$0" : v < 0.01 ? `$${Number(v.toPrecision(2))}` : `$${v.toFixed(v < 100 ? 2 : 0)}`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtInt = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString());

const LANG_NAMES: Record<string, string> = {
  tr: "Turkish", en: "English", de: "German", ru: "Russian", fr: "French", ar: "Arabic", fa: "Persian", ur: "Urdu", unknown: "Unclear",
};
const CHANNEL_NAMES: Record<string, string> = { widget: "Website widget", playground: "Chat Playground", whatsapp: "WhatsApp", eval: "Evaluation" };
const TOOL_NAMES: Record<string, string> = {
  search_knowledge: "Knowledge search", check_availability: "Availability check", book_appointment: "Booking",
  get_order_status: "Order lookup", handoff_to_human: "Human hand-off",
};
const ERROR_NAMES: Record<string, string> = {
  rate_limit: "AI quota reached", connection: "AI provider unreachable", config: "Setup problem", other: "Other error",
};
const RANGES = [7, 30, 90];

// ------------------------------------------------------------ pieces

function Section({ title, icon: Icon, children, i = 0, action, className }: {
  title: string; icon: typeof Activity; children: React.ReactNode; i?: number; action?: React.ReactNode; className?: string;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.05 }}
      className={clsx("rounded-3xl border border-line bg-card p-6 backdrop-blur-xl", className)}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-medium"><Icon size={18} className="text-accent" />{title}</h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

/** Change vs the previous period. `lowerIsBetter` flips the colour (faster / cheaper is good). */
function Delta({ now, before, lowerIsBetter, days }: { now: number | null; before: number | null; lowerIsBetter?: boolean; days: number }) {
  if (now == null || before == null || before === 0) return <span className="text-xs text-muted">no earlier data</span>;
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return <span className="text-xs text-muted">same as previous {days} days</span>;
  const good = lowerIsBetter ? change < 0 : change > 0;
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={clsx("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-emerald-300" : "text-red-300")}>
      <Icon size={13} />{Math.abs(change) >= 10 ? ">999" : Math.round(Math.abs(change) * 100)}%
      <span className="ms-1 font-normal text-muted">vs previous {days} days</span>
    </span>
  );
}

function Tile({ label, value, sub, icon: Icon, spark, delta, i }: {
  label: string; value: string; sub?: React.ReactNode; icon: typeof Activity; spark?: (number | null)[]; delta?: React.ReactNode; i: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.04 * i }}
      whileHover={{ y: -3 }} className="group relative overflow-hidden rounded-3xl border border-line bg-card p-5 backdrop-blur-xl">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-accent/10 opacity-0 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted"><Icon size={15} />{label}</p>
        {spark && <Sparkline values={spark} />}
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <div className="mt-1.5 min-h-5">{delta}</div>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </motion.div>
  );
}

function Segmented({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex rounded-2xl border border-line bg-white/[0.03] p-1" role="radiogroup" aria-label="Time range">
      {RANGES.map((d) => (
        <button key={d} role="radio" aria-checked={value === d} onClick={() => onChange(d)}
          className={clsx("relative rounded-xl px-4 py-2 text-sm transition-colors", value === d ? "text-black" : "text-muted hover:text-foreground")}>
          {value === d && <motion.span layoutId="range-pill" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
          <span className="relative">Last {d} days</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ page

export default function AnalyticsPage() {
  const { current, tenants, select } = useTenant();
  const tid = current?.id;
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ key: string; a: Analytics } | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [evalReport, setEvalReport] = useState<EvalReport | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const key = `${tid}:${days}`;
  useEffect(() => {
    let alive = true;
    if (tid) analyticsApi.tenant(tid, days).then((a) => alive && setData({ key: `${tid}:${days}`, a }), (e: Error) => alive && setError(e.message));
    analyticsApi.overview(days).then((o) => alive && setOverview(o), () => {});
    return () => { alive = false; };
  }, [tid, days]);
  useEffect(() => {
    let alive = true;
    analyticsApi.latestEval().then((r) => alive && setEvalReport(r), () => alive && setEvalReport(null));
    return () => { alive = false; };
  }, []);

  if (!current) return null;
  const a = data?.a;
  const loading = !data || data.key !== key;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">Analytics</p>
          <h1 className="mt-2 font-display text-5xl md:text-6xl">Cost, speed &amp; <span className="italic text-gradient">quality</span></h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">How your agent performs for <b className="text-foreground">{current.name}</b>: what it would cost on a paid plan, how fast it answers, and how often it gets things right.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {a && <TracingBadge tracing={a.tracing} />}
          <Segmented value={days} onChange={setDays} />
        </div>
      </motion.header>

      {error && <p className="mt-6 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-200">{error}</p>}

      {overview && overview.businesses.length > 1 && (
        <Comparison overview={overview} currentId={current.id} onSelect={select} known={tenants.map((t) => t.id)} />
      )}

      <AnimatePresence mode="wait">
        {loading || !a ? (
          <motion.div key="loading" exit={{ opacity: 0 }} className="mt-20 grid place-items-center text-muted"><Loader2 className="animate-spin" /></motion.div>
        ) : a.totals.answers + a.totals.errors === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="mt-10 rounded-3xl border border-dashed border-line p-12 text-center">
            <Activity className="mx-auto text-accent" size={30} />
            <h2 className="mt-4 text-2xl font-medium">No answers in the last {days} days</h2>
            <p className="mt-2 text-muted">Ask something in the <Link href="/dashboard/chat" className="text-accent hover:underline">Chat Playground</Link> or on your website, and the numbers appear here.</p>
          </motion.div>
        ) : (
          <motion.div key={key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8 flex flex-col gap-8">
            <Tiles a={a} days={days} />

            <div className="grid gap-8 xl:grid-cols-2">
              <Section title="Answers per day" icon={MessagesSquare} i={1}
                action={<button onClick={() => setShowTable((s) => !s)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-white/5 hover:text-foreground"><Table2 size={15} />{showTable ? "Charts" : "Table"}</button>}>
                {showTable ? <DailyTable a={a} /> : (
                  <ColumnChart label="Answers per day" color={SERIES.gold} format={(v) => fmtInt(v)}
                    data={a.daily.map((d) => ({ date: d.date, value: d.answers }))} />
                )}
              </Section>
              <Section title="Response time" icon={Timer} i={2} action={
                <Legend items={[{ name: "Typical (p50)", color: SERIES.gold }, { name: "Slowest 5% (p95)", color: SERIES.violet }, { name: "First word", color: SERIES.cyan }]} />}>
                <LineChart label="Response time per day" format={fmtMs} dates={a.daily.map((d) => d.date)} series={[
                  { key: "p50", name: "p50", color: SERIES.gold, values: a.daily.map((d) => d.latency_p50) },
                  { key: "p95", name: "p95", color: SERIES.violet, values: a.daily.map((d) => d.latency_p95) },
                  { key: "ft", name: "First word", color: SERIES.cyan, values: a.daily.map((d) => d.first_token_p50) },
                ]} />
              </Section>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Section title="Estimated cost per day" icon={CircleDollarSign} i={3}
                action={<span className="text-sm text-muted">{(a.totals.prompt_tokens + a.totals.completion_tokens).toLocaleString()} tokens in {days} days</span>}>
                <ColumnChart label="Estimated cost per day" color={SERIES.violet} format={fmtUsd} height={200}
                  data={a.daily.map((d) => ({ date: d.date, value: d.cost_usd }))} />
                <CostNote a={a} days={days} />
              </Section>
              <QualityCard report={evalReport} i={4} />
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
              <Section title="Languages" icon={Languages} i={5}>
                <BarList rows={a.languages.map((l) => ({ label: LANG_NAMES[l.language] ?? l.language, value: l.count }))} format={(v) => `${v} question${v === 1 ? "" : "s"}`} />
              </Section>
              <Section title="Channels" icon={Radio} i={6}>
                <BarList color={SERIES.cyan} rows={a.channels.map((c) => ({ label: CHANNEL_NAMES[c.channel] ?? c.channel, value: c.conversations }))}
                  format={(v) => `${v} conversation${v === 1 ? "" : "s"}`} />
              </Section>
              <Section title="Agent tools" icon={Wrench} i={7}>
                {a.tools.length ? (
                  <BarList color={SERIES.violet} rows={a.tools.map((t) => ({ label: TOOL_NAMES[t.name] ?? t.name, value: t.calls, note: t.errors ? `${t.errors} failed` : undefined }))}
                    format={(v) => `${v} call${v === 1 ? "" : "s"}`} />
                ) : <p className="text-sm text-muted">No tools used in this period.</p>}
              </Section>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Slowest a={a} />
              <Reliability a={a} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TracingBadge({ tracing }: { tracing: Analytics["tracing"] }) {
  return tracing.enabled ? (
    <a href={tracing.base_url ?? "#"} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-400/15">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-emerald-400" /></span>
      Langfuse tracing on <ExternalLink size={13} />
    </a>
  ) : (
    <span title="Add LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to backend/.env to trace every answer step by step."
      className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-muted">
      <span className="h-2 w-2 rounded-full bg-white/25" /> Tracing off
    </span>
  );
}

function Tiles({ a, days }: { a: Analytics; days: number }) {
  const t = a.totals, p = a.previous;
  const tiles = [
    { label: "Conversations", icon: MessagesSquare, value: fmtInt(t.conversations), spark: a.daily.map((d) => d.conversations),
      delta: <Delta now={t.conversations} before={p.conversations} days={days} />, sub: `${t.questions} questions` },
    { label: "Answers", icon: Bot, value: fmtInt(t.answers), spark: a.daily.map((d) => d.answers),
      delta: <Delta now={t.answers} before={p.answers} days={days} /> },
    { label: "Estimated cost", icon: CircleDollarSign, value: fmtUsd(t.cost_usd), spark: a.daily.map((d) => d.cost_usd),
      delta: <Delta now={t.cost_usd} before={p.cost_usd} days={days} lowerIsBetter />, sub: "at paid list prices; free tier = $0" },
    { label: "Cost per answer", icon: Gauge, value: fmtUsd(t.cost_per_answer_usd),
      delta: <Delta now={t.cost_per_answer_usd} before={p.cost_per_answer_usd} days={days} lowerIsBetter />,
      sub: t.cost_per_answer_usd > 0 ? `≈ ${Math.round(1 / t.cost_per_answer_usd).toLocaleString()} answers per $1` : undefined },
    { label: "Answer time (typical)", icon: Timer, value: fmtMs(t.latency_ms.p50), spark: a.daily.map((d) => d.latency_p50),
      delta: <Delta now={t.latency_ms.p50} before={p.latency_ms.p50} days={days} lowerIsBetter />, sub: `slowest 5%: ${fmtMs(t.latency_ms.p95)}` },
    { label: "First word appears", icon: Zap, value: fmtMs(t.first_token_ms.p50), spark: a.daily.map((d) => d.first_token_p50),
      delta: <Delta now={t.first_token_ms.p50} before={p.first_token_ms.p50} days={days} lowerIsBetter />, sub: `slowest 5%: ${fmtMs(t.first_token_ms.p95)}` },
    { label: "Answers with sources", icon: Quote, value: fmtPct(t.cited_rate),
      delta: <Delta now={t.cited_rate} before={p.cited_rate} days={days} />, sub: "cite your documents" },
    { label: "Successful answers", icon: CheckCircle2, value: fmtPct(1 - t.error_rate), spark: a.daily.map((d) => d.errors),
      delta: <Delta now={1 - t.error_rate} before={p.answers + p.errors ? 1 - p.error_rate : null} days={days} />,
      sub: `${t.errors} failed · ${t.handoffs} hand-offs · ${t.bookings} bookings` },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile, i) => <Tile key={tile.label} i={i} {...tile} />)}
    </div>
  );
}

function CostNote({ a, days }: { a: Analytics; days: number }) {
  const perMonth = (a.totals.cost_usd / days) * 30;
  const unpriced = a.models.filter((m) => !m.priced);
  return (
    <div className="mt-4 grid gap-3 rounded-2xl border border-line bg-white/[0.02] p-4 text-sm sm:grid-cols-3">
      <div><p className="text-muted">At this pace, per month</p><p className="mt-1 text-lg font-medium tabular-nums">{fmtUsd(perMonth)}</p></div>
      <div><p className="text-muted">Per 1,000 answers</p><p className="mt-1 text-lg font-medium tabular-nums">{fmtUsd(a.totals.cost_per_answer_usd * 1000)}</p></div>
      <div><p className="text-muted">Model</p><p className="mt-1 truncate font-mono text-xs leading-7">{a.models.map((m) => m.model).join(", ")}</p></div>
      {unpriced.length > 0 && <p className="text-xs text-amber-200 sm:col-span-3">No list price known for {unpriced.map((m) => m.model).join(", ")}; those answers count as $0.</p>}
    </div>
  );
}

function DailyTable({ a }: { a: Analytics }) {
  return (
    <div className="max-h-[260px] overflow-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[#111118] text-left text-muted">
          <tr>{["Day", "Answers", "Conversations", "p50", "p95", "First word", "Cost", "Failed"].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody className="tabular-nums">
          {[...a.daily].reverse().map((d) => (
            <tr key={d.date} className="border-t border-line/60">
              <td className="px-3 py-1.5">{shortDate(d.date)}</td><td className="px-3">{d.answers}</td><td className="px-3">{d.conversations}</td>
              <td className="px-3">{fmtMs(d.latency_p50)}</td><td className="px-3">{fmtMs(d.latency_p95)}</td><td className="px-3">{fmtMs(d.first_token_p50)}</td>
              <td className="px-3">{fmtUsd(d.cost_usd)}</td><td className="px-3">{d.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Slowest({ a }: { a: Analytics }) {
  return (
    <Section title="Slowest answers" icon={Timer} i={8}>
      <ul className="flex flex-col divide-y divide-line/60">
        {a.slowest.map((s) => (
          <li key={s.message_id} className="flex items-center gap-4 py-3">
            <span className="w-16 shrink-0 text-right font-medium tabular-nums">{fmtMs(s.latency_ms)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" dir="auto">{s.question || "—"}</span>
              <span className="text-xs text-muted">{new Date(s.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · first word {fmtMs(s.first_token_ms)}</span>
            </span>
            <span className="flex shrink-0 gap-2">
              <Link href={`/dashboard/conversations?c=${s.conversation_id}`} className="rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-white/5 hover:text-foreground">Open</Link>
              {s.trace_url && <a href={s.trace_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-accent hover:bg-accent/10">Trace <ExternalLink size={12} /></a>}
            </span>
          </li>
        ))}
      </ul>
      {!a.tracing.enabled && <p className="mt-3 text-xs text-muted">Turn on Langfuse to see every step of an answer (search, tools, model calls) with its own timing.</p>}
    </Section>
  );
}

function Reliability({ a }: { a: Analytics }) {
  return (
    <Section title="Reliability" icon={AlertTriangle} i={9}>
      {a.error_kinds.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-emerald-100">
          <CheckCircle2 size={20} className="shrink-0" /> Every question got an answer in this period.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {a.error_kinds.map((e) => (
            <li key={e.kind} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white/[0.02] px-4 py-3">
              <span className="flex items-center gap-2"><XCircle size={16} className="text-red-300" />{ERROR_NAMES[e.kind] ?? e.kind}</span>
              <span className="tabular-nums text-muted">{e.count}×</span>
            </li>
          ))}
          {a.error_kinds.some((e) => e.kind === "rate_limit") && (
            <p className="text-xs text-muted">“AI quota reached” means the free tier&apos;s per-minute limit. A paid plan removes it.</p>
          )}
        </ul>
      )}
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl border border-line bg-white/[0.02] p-4"><p className="flex items-center gap-2 text-muted"><Globe2 size={14} /> Hand-offs</p><p className="mt-1 text-2xl font-semibold tabular-nums">{a.totals.handoffs}</p></div>
        <div className="rounded-2xl border border-line bg-white/[0.02] p-4"><p className="flex items-center gap-2 text-muted"><BookCheck size={14} /> Bookings</p><p className="mt-1 text-2xl font-semibold tabular-nums">{a.totals.bookings}</p></div>
      </div>
    </Section>
  );
}

function QualityCard({ report, i }: { report: EvalReport | undefined; i: number }) {
  return (
    <Section title="Quality check" icon={FlaskConical} i={i}
      action={report ? <span className="text-xs text-muted">{new Date(report.started_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span> : undefined}>
      {report === undefined ? <Loader2 className="animate-spin text-muted" /> : report === null ? (
        <p className="text-sm text-muted">No evaluation run yet. Run <code className="font-mono text-xs">python -m app.evals.run</code> in the backend.</p>
      ) : (
        <>
          <div className="flex items-center gap-5">
            <Ring value={report.summary.pass_rate} />
            <div>
              <p className="text-2xl font-semibold">{report.summary.passed} of {report.summary.cases} test questions passed</p>
              <p className="mt-1 text-sm text-muted">8 languages · answers, sources, tools and safety · typical answer {fmtMs(report.summary.latency_ms.p50)}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
            {Object.entries(report.summary.by_tag).sort().map(([tag, g]) => (
              <div key={tag}>
                <div className="flex justify-between text-sm"><span className="capitalize">{tag}</span><span className="tabular-nums text-muted">{g.passed}/{g.total}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-400/15">
                  <motion.div className="h-full rounded-full bg-emerald-400" initial={{ width: 0 }} animate={{ width: `${(g.passed / g.total) * 100}%` }} transition={{ duration: 0.8 }} />
                </div>
              </div>
            ))}
          </div>
          {report.cases.some((c) => !c.passed) && (
            <ul className="mt-5 flex flex-col gap-2 text-sm">
              {report.cases.filter((c) => !c.passed).map((c) => (
                <li key={c.id} className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2">
                  <span className="flex items-center gap-2 font-mono text-xs text-red-200"><XCircle size={13} />{c.id}</span>
                  <span className="mt-0.5 block text-xs text-muted">{c.failed.join("; ")}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function Ring({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-20 w-20 shrink-0 place-items-center">
      <svg width={80} height={80} className="-rotate-90">
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(52,211,153,0.15)" strokeWidth={7} />
        <motion.circle cx={40} cy={40} r={r} fill="none" stroke="#34d399" strokeWidth={7} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value) }} transition={{ duration: 1.1, ease: "easeOut" }} />
      </svg>
      <span className="absolute text-lg font-semibold tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}

function Comparison({ overview, currentId, onSelect, known }: { overview: Overview; currentId: string; onSelect: (id: string) => void; known: string[] }) {
  const rows = overview.businesses.filter((b) => known.includes(b.tenant_id));
  return (
    <Section title="All your businesses" icon={Activity} className="mt-8" action={<span className="text-sm text-muted">last {overview.days} days · click a row to open it</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-muted">
            <tr>{["Business", "Answers", "Est. cost", "Per answer", "Typical answer", "First word", "With sources", "Failed"].map((h) => <th key={h} className="px-3 pb-3 font-normal">{h}</th>)}</tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((b) => (
              <tr key={b.tenant_id} onClick={() => onSelect(b.tenant_id)}
                className={clsx("cursor-pointer border-t border-line/60 transition-colors hover:bg-white/[0.03]", b.tenant_id === currentId && "bg-accent/[0.06]")}>
                <td className="px-3 py-3 font-medium"><span className="flex items-center gap-2">{b.tenant_id === currentId && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}{b.name}</span></td>
                <td className="px-3">{b.answers}</td><td className="px-3">{fmtUsd(b.cost_usd)}</td><td className="px-3">{fmtUsd(b.cost_per_answer_usd)}</td>
                <td className="px-3">{fmtMs(b.latency_ms.p50)}</td><td className="px-3">{fmtMs(b.first_token_ms.p50)}</td>
                <td className="px-3">{b.answers ? fmtPct(b.cited_rate) : "—"}</td><td className="px-3">{b.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
