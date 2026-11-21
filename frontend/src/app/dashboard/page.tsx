"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  ArrowRight, BarChart3, Bot, CalendarCheck, Check, ChevronRight, FileText, Globe, Hand, KeyRound, Loader2,
  MessageCircleMore, MessagesSquare, Radar, Sparkles, UserRound, Users, Wrench,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import { useTenant } from "@/components/dashboard/TenantContext";
import { WhatsAppIcon } from "@/components/icons/WhatsAppIcon";
import { ColumnChart, SERIES } from "@/components/analytics/charts";
import { analyticsApi, overviewApi, type Analytics, type OverviewData } from "@/lib/api";
import { CHANNEL_NAMES, LANG_NAMES, timeAgo } from "@/lib/format";

function greeting(hour: number) {
  return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const STEPS: { key: keyof OverviewData["setup"]; title: string; body: string; href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>; optional?: boolean }[] = [
  { key: "documents", title: "Add your knowledge", body: "Upload PDFs, web pages or text about your business.", href: "/dashboard/knowledge", icon: FileText },
  { key: "tools", title: "Set hours and tools", body: "Opening hours, services, and what the agent may do.", href: "/dashboard/tools", icon: Wrench },
  { key: "tested", title: "Try the agent", body: "Ask it a few questions in the Chat Playground.", href: "/dashboard/chat", icon: Bot },
  { key: "widget_key", title: "Get the website code", body: "Style the chat bubble and create a widget key.", href: "/dashboard/widget", icon: KeyRound },
  { key: "widget_live", title: "First website visitor", body: "Paste the code on your site; the first chat ticks this.", href: "/dashboard/widget", icon: Globe },
  { key: "whatsapp", title: "Connect WhatsApp", body: "Answer customers on WhatsApp too, in their language.", href: "/dashboard/whatsapp", icon: WhatsAppIcon, optional: true },
  { key: "team", title: "Invite your team", body: "So colleagues can answer when a human is needed.", href: "/dashboard/team", icon: Users, optional: true },
  { key: "tracing", title: "Turn on tracing", body: "Optional: see every step of every answer in Langfuse.", href: "/dashboard/analytics", icon: Radar, optional: true },
];

export default function OverviewPage() {
  const { me } = useAuth();
  const { current } = useTenant();
  const tid = current?.id;
  const [data, setData] = useState<{ tid: string; o: OverviewData } | null>(null);
  const [week, setWeek] = useState<{ tid: string; a: Analytics } | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (!tid) return;
    let alive = true;
    overviewApi.get(tid).then((o) => alive && setData({ tid, o }), () => {});
    analyticsApi.tenant(tid, 7).then((a) => alive && setWeek({ tid, a }), () => {});
    return () => { alive = false; };
  }, [tid]);

  if (!current) return <NoBusiness />;
  const o = data && data.tid === tid ? data.o : null;
  const a = week && week.tid === tid ? week.a : null;
  const firstName = me.name.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">
          {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="mt-2 font-display text-5xl md:text-6xl">
          {greeting(now.getHours())}, <span className="italic text-gradient">{firstName}</span>
        </h1>
        <p className="mt-3 text-lg text-muted">Here&apos;s what&apos;s happening at <b className="text-foreground">{current.name}</b>.</p>
      </motion.header>

      {!o ? (
        <div className="mt-20 grid place-items-center text-muted"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          <AnimatePresence>
            {o.today.needs_human > 0 && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Link href="/dashboard/conversations?status=handoff"
                  className="group flex items-center gap-4 rounded-3xl border border-accent/40 bg-accent/[0.08] p-5 transition-colors hover:bg-accent/[0.12]">
                  <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-accent/20 text-accent">
                    <Hand size={22} />
                    <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-accent" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-lg font-medium">
                      {o.today.needs_human} conversation{o.today.needs_human > 1 ? "s" : ""} need{o.today.needs_human > 1 ? "" : "s"} a human
                    </span>
                    <span className="text-sm text-muted">Customers asked for a person, or the agent couldn&apos;t help. Open the inbox to reply.</span>
                  </span>
                  <ArrowRight className="text-accent transition-transform group-hover:translate-x-1" />
                </Link>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Conversations today", value: o.today.conversations, icon: MessagesSquare },
              { label: "Answers today", value: o.today.answers, icon: Bot },
              { label: "Bookings today", value: o.today.bookings, icon: CalendarCheck },
              { label: "Waiting for a human", value: o.today.needs_human, icon: UserRound, hot: o.today.needs_human > 0 },
            ].map((t, i) => (
              <motion.div key={t.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                whileHover={{ y: -3 }}
                className={clsx("rounded-3xl border p-5 backdrop-blur-xl", t.hot ? "border-accent/40 bg-accent/[0.06]" : "border-line bg-card")}>
                <p className="flex items-center gap-2 text-sm text-muted"><t.icon size={15} />{t.label}</p>
                <motion.p key={t.value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 text-4xl font-semibold tabular-nums">{t.value}</motion.p>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Recent o={o} />
            <Setup o={o} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xl font-medium"><BarChart3 size={18} className="text-accent" />Last 7 days</h2>
                <Link href="/dashboard/analytics" className="flex items-center gap-1 text-sm text-muted hover:text-foreground">Analytics <ChevronRight size={15} /></Link>
              </div>
              {!a ? <Loader2 className="animate-spin text-muted" /> : (
                <>
                  <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
                    <Mini label="Answers" value={a.totals.answers.toLocaleString()} />
                    <Mini label="Typical answer time" value={a.totals.latency_ms.p50 == null ? "—" : `${(a.totals.latency_ms.p50 / 1000).toFixed(1)} s`} />
                    <Mini label="With sources" value={a.totals.answers ? `${Math.round(a.totals.cited_rate * 100)}%` : "—"} />
                  </div>
                  <ColumnChart label="Answers per day, last 7 days" color={SERIES.gold} height={170} format={(v) => String(v)}
                    data={a.daily.map((d) => ({ date: d.date, value: d.answers }))} />
                </>
              )}
            </motion.section>
            <Upcoming o={o} />
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.02] p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Recent({ o }: { o: OverviewData }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
      className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-medium"><MessagesSquare size={18} className="text-accent" />Latest conversations</h2>
        <Link href="/dashboard/conversations" className="flex items-center gap-1 text-sm text-muted hover:text-foreground">Inbox <ChevronRight size={15} /></Link>
      </div>
      {o.recent.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-8 text-center text-muted">
          No conversations yet. <Link href="/dashboard/chat" className="text-accent hover:underline">Try the agent</Link> to see one here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {o.recent.map((c, i) => (
            <motion.li key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.04 }}>
              <Link href={`/dashboard/conversations?c=${c.id}`} className="flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-white/[0.04]">
                <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                  c.channel === "widget" ? "bg-cyan/15 text-cyan" : "bg-violet/15 text-violet")}>
                  {c.channel === "widget" ? <MessageCircleMore size={18} /> : <Bot size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={clsx("truncate", c.unread && "font-semibold")} dir="auto">{c.title ?? "Conversation"}</span>
                    {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-violet" />}
                  </span>
                  <span className="block truncate text-sm text-muted" dir="auto">
                    {c.last_message?.role === "staff" ? "Team: " : c.last_message?.role === "assistant" ? "AI: " : ""}{c.last_message?.preview}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-muted">{timeAgo(c.last_message_at)}</span>
                  <span className="flex gap-1 text-[11px]">
                    {c.status === "handoff" && <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-accent">Needs human</span>}
                    {c.language && <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-muted">{LANG_NAMES[c.language] ?? c.language}</span>}
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-muted">{CHANNEL_NAMES[c.channel] ?? c.channel}</span>
                  </span>
                </span>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}

function Setup({ o }: { o: OverviewData }) {
  const done = STEPS.filter((s) => o.setup[s.key]).length;
  const required = STEPS.filter((s) => !s.optional);
  const allRequired = required.every((s) => o.setup[s.key]);
  const pct = done / STEPS.length;
  const r = 26, c = 2 * Math.PI * r;
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
      className="relative overflow-hidden rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl" />
      <div className="mb-4 flex items-center gap-4">
        <div className="relative grid h-16 w-16 place-items-center">
          <svg width={64} height={64} className="-rotate-90">
            <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(245,181,68,0.15)" strokeWidth={6} />
            <motion.circle cx={32} cy={32} r={r} fill="none" stroke="#f5b544" strokeWidth={6} strokeLinecap="round" strokeDasharray={c}
              initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1, ease: "easeOut" }} />
          </svg>
          <span className="absolute text-sm font-semibold tabular-nums">{done}/{STEPS.length}</span>
        </div>
        <div>
          <h2 className="flex items-center gap-2 text-xl font-medium"><Sparkles size={18} className="text-accent" />
            {allRequired ? "You're live" : "Get set up"}</h2>
          <p className="text-sm text-muted">{allRequired ? "The essentials are done. Optional extras below." : "A few steps to a working AI agent on your website."}</p>
        </div>
      </div>
      <ul className="flex flex-col gap-1">
        {STEPS.map((s, i) => {
          const ok = o.setup[s.key];
          return (
            <motion.li key={s.key} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.04 }}>
              <Link href={s.href} className={clsx("group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]", ok && "opacity-60")}>
                <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors",
                  ok ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300" : "border-line text-muted group-hover:border-accent/50 group-hover:text-accent")}>
                  {ok ? <Check size={15} /> : <s.icon size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={clsx("block text-sm font-medium", ok && "line-through decoration-white/30")}>
                    {s.title}{s.optional && <span className="ms-2 text-xs font-normal text-muted">optional</span>}
                    {s.key === "documents" && o.setup.documents_total > 0 && <span className="ms-2 text-xs font-normal text-muted">{o.setup.documents_ready} ready</span>}
                  </span>
                  {!ok && <span className="block truncate text-xs text-muted">{s.body}</span>}
                </span>
                {!ok && <ChevronRight size={16} className="text-muted transition-transform group-hover:translate-x-0.5" />}
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </motion.section>
  );
}

function Upcoming({ o }: { o: OverviewData }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
      className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-medium"><CalendarCheck size={18} className="text-accent" />Upcoming appointments</h2>
        <Link href="/dashboard/tools" className="flex items-center gap-1 text-sm text-muted hover:text-foreground">All <ChevronRight size={15} /></Link>
      </div>
      {o.upcoming.length === 0 ? (
        <p className="text-sm text-muted">No upcoming bookings. When customers book through the agent, they appear here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {o.upcoming.map((a) => {
            const d = new Date(a.start_at);
            return (
              <li key={a.id} className="flex items-center gap-4 rounded-2xl border border-line bg-white/[0.02] p-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/10 text-center leading-tight text-accent">
                  <span><span className="block text-lg font-semibold">{d.toLocaleDateString(undefined, { timeZone: o.business.timezone, day: "numeric" })}</span>
                    <span className="block text-[10px] uppercase">{d.toLocaleDateString(undefined, { timeZone: o.business.timezone, month: "short" })}</span></span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.customer_name}</span>
                  <span className="block text-sm text-muted">{a.service} · {d.toLocaleTimeString(undefined, { timeZone: o.business.timezone, hour: "2-digit", minute: "2-digit" })}</span>
                </span>
                <span className="font-mono text-xs text-muted">{a.code}</span>
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

function NoBusiness() {
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-6 text-center">
      <div>
        <Sparkles className="mx-auto text-accent" size={32} />
        <h1 className="mt-4 font-display text-5xl">Welcome to Rehber</h1>
        <p className="mt-3 text-lg text-muted">Create your first business with the switcher in the menu, or open an invitation link a colleague sent you.</p>
      </div>
    </div>
  );
}
