"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  CalendarCheck, Check, Clock, Loader2, MessageSquareShare, Package, Plus, Save, Trash2, UserRound, X,
} from "lucide-react";
import { useTenant } from "@/components/dashboard/TenantContext";
import {
  toolsApi, type Appointment, type BusinessSettings, type Handoff, type Order, type Weekday,
} from "@/lib/api";

const DAYS: { key: Weekday; label: string }[] = [
  { key: "mon", label: "Monday" }, { key: "tue", label: "Tuesday" }, { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" }, { key: "fri", label: "Friday" }, { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const TOOL_INFO = [
  { key: "booking" as const, icon: CalendarCheck, title: "Appointment booking", body: "Checks free times and books after the customer confirms." },
  { key: "orders" as const, icon: Package, title: "Order lookup", body: "Shares order status only with the matching email or phone." },
  { key: "handoff" as const, icon: UserRound, title: "Human hand-off", body: "Flags the conversation so your team can take over." },
];

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={clsx("relative h-7 w-12 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-white/15")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={clsx("absolute top-1 h-5 w-5 rounded-full bg-white shadow", on ? "right-1" : "left-1")}
      />
    </button>
  );
}

function Card({ title, icon: Icon, children, action, i = 0 }: {
  title: string; icon: typeof Clock; children: React.ReactNode; action?: React.ReactNode; i?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + i * 0.06 }}
      className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-medium"><Icon size={18} className="text-accent" />{title}</h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

const inputCls = "rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-accent";

function fmtWhen(iso: string, tz: string) {
  return new Date(iso).toLocaleString(undefined, {
    timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function ToolsPage() {
  const { current } = useTenant();
  const tid = current?.id;
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const loadLists = useCallback(async () => {
    if (!tid) return;
    const [a, o, h] = await Promise.all([toolsApi.appointments(tid), toolsApi.orders(tid), toolsApi.handoffs(tid)]);
    setAppointments(a);
    setOrders(o);
    setHandoffs(h);
  }, [tid]);

  useEffect(() => {
    let alive = true;
    if (!tid) return;
    Promise.all([toolsApi.getSettings(tid), toolsApi.appointments(tid), toolsApi.orders(tid), toolsApi.handoffs(tid)])
      .then(([s, a, o, h]) => {
        if (!alive) return;
        setSettings(s);
        setAppointments(a);
        setOrders(o);
        setHandoffs(h);
      })
      .catch((e: Error) => alive && setToast({ ok: false, text: e.message }));
    return () => { alive = false; };
  }, [tid]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!current || !settings) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="animate-spin text-accent" size={30} /></div>;
  }

  const update = (fn: (s: BusinessSettings) => BusinessSettings) => setSettings((s) => (s ? fn(structuredClone(s)) : s));

  const save = async () => {
    setSaving(true);
    try {
      setSettings(await toolsApi.saveSettings(current.id, settings));
      setToast({ ok: true, text: "Saved. The agent uses the new settings from the next message." });
    } catch (e) {
      setToast({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await loadLists();
    } catch (e) {
      setToast({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">Agent tools</p>
          <h1 className="mt-2 font-display text-5xl md:text-6xl">What the agent can <span className="italic text-gradient">do</span></h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">Turn actions on or off, set opening hours and services, and see what the agent has done.</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)] disabled:opacity-60"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Save settings
        </motion.button>
      </motion.header>

      {/* Tool switches */}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {TOOL_INFO.map((t, i) => {
          const on = settings.tools[t.key];
          return (
            <motion.div
              key={t.key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className={clsx("rounded-3xl border p-6 transition-colors", on ? "border-accent/40 bg-accent/[0.06]" : "border-line bg-card")}
            >
              <div className="flex items-start justify-between gap-4">
                <div className={clsx("grid h-12 w-12 place-items-center rounded-2xl border transition-colors", on ? "border-accent/40 bg-accent/15" : "border-line bg-white/[0.04]")}>
                  <t.icon size={22} className={on ? "text-accent" : "text-muted"} />
                </div>
                <Switch on={on} onChange={(v) => update((s) => { s.tools[t.key] = v; return s; })} />
              </div>
              <h3 className="mt-4 text-lg font-medium">{t.title}</h3>
              <p className="mt-1 text-sm text-muted">{t.body}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-2">
        <div className="flex flex-col gap-8">
          <Card title="Opening hours" icon={Clock} i={1}
            action={<input value={settings.timezone} onChange={(e) => update((s) => ({ ...s, timezone: e.target.value }))} className={clsx(inputCls, "w-48 font-mono text-xs")} title="Timezone" />}>
            <div className="flex flex-col gap-2">
              {DAYS.map((d) => {
                const span = settings.booking.hours[d.key];
                const [from, to] = span ? span.split("-") : ["09:00", "18:00"];
                return (
                  <div key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="w-24 text-sm sm:w-28">{d.label}</span>
                    <Switch on={!!span} onChange={(v) => update((s) => { s.booking.hours[d.key] = v ? "09:00-18:00" : null; return s; })} />
                    {span ? (
                      <div className="flex items-center gap-2">
                        <input type="time" value={from} onChange={(e) => update((s) => { s.booking.hours[d.key] = `${e.target.value}-${to}`; return s; })} className={inputCls} />
                        <span className="text-muted">–</span>
                        <input type="time" value={to} onChange={(e) => update((s) => { s.booking.hours[d.key] = `${from}-${e.target.value}`; return s; })} className={inputCls} />
                      </div>
                    ) : (
                      <span className="text-sm text-muted">Closed</span>
                    )}
                  </div>
                );
              })}
              <label className="mt-3 flex items-center gap-3 text-sm text-muted">
                Offer a start time every
                <input type="number" min={5} max={240} value={settings.booking.slot_minutes}
                  onChange={(e) => update((s) => { s.booking.slot_minutes = Number(e.target.value) || 30; return s; })}
                  className={clsx(inputCls, "w-20")} />
                minutes
              </label>
            </div>
          </Card>

          <Card title="Services" icon={CalendarCheck} i={2}
            action={
              <button onClick={() => update((s) => { s.booking.services.push({ name: "New service", minutes: 30 }); return s; })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-white/5">
                <Plus size={14} /> Add
              </button>
            }>
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {settings.booking.services.map((svc, i) => (
                  <motion.div key={i} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex items-center gap-2">
                    <input value={svc.name} onChange={(e) => update((s) => { s.booking.services[i].name = e.target.value; return s; })} className={clsx(inputCls, "min-w-0 flex-1")} />
                    <input type="number" min={5} max={480} value={svc.minutes}
                      onChange={(e) => update((s) => { s.booking.services[i].minutes = Number(e.target.value) || 30; return s; })}
                      className={clsx(inputCls, "w-20")} />
                    <span className="text-xs text-muted">min</span>
                    <button onClick={() => update((s) => { s.booking.services.splice(i, 1); return s; })} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-red-300" aria-label="Remove service">
                      <Trash2 size={15} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-8">
          <Card title={`Needs a human (${handoffs.length})`} icon={UserRound} i={3}>
            {handoffs.length === 0 ? (
              <p className="text-sm text-muted">No open hand-offs. 🎉</p>
            ) : (
              <ul className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {handoffs.map((h) => (
                    <motion.li key={h.id} layout exit={{ opacity: 0, x: 30 }} className="flex items-center gap-3 rounded-2xl border border-violet/30 bg-violet/[0.08] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{h.handoff_reason ?? h.title}</p>
                        <p className="text-xs text-muted">{h.customer_contact ?? "no contact given"} · {h.handoff_at ? new Date(h.handoff_at).toLocaleString() : ""}</p>
                      </div>
                      <Link href={`/dashboard/conversations?c=${h.id}`} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-foreground" title="Open conversation">
                        <MessageSquareShare size={16} />
                      </Link>
                      <button onClick={() => act(() => toolsApi.resolve(current.id, h.id))} className="inline-flex items-center gap-1 rounded-lg bg-violet/40 px-3 py-1.5 text-xs font-medium hover:bg-violet/60">
                        <Check size={13} /> Resolve
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </Card>

          <Card title={`Upcoming appointments (${appointments.filter((a) => a.status === "confirmed").length})`} icon={CalendarCheck} i={4}>
            {appointments.length === 0 ? (
              <p className="text-sm text-muted">No bookings yet. Try “Can I book a consultation on Friday?” in the Chat Playground.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {appointments.map((a) => (
                  <li key={a.id} className={clsx("flex items-center gap-3 rounded-2xl border px-4 py-3", a.status === "cancelled" ? "border-line opacity-50" : "border-emerald-400/25 bg-emerald-400/[0.05]")}>
                    <span className="rounded-md border border-emerald-300/40 px-2 py-0.5 font-mono text-xs text-emerald-300">{a.code}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.customer_name} · {a.service}</p>
                      <p className="text-xs text-muted">{fmtWhen(a.start_at, settings.timezone)} · {a.customer_contact}</p>
                    </div>
                    {a.status === "confirmed" ? (
                      <button onClick={() => act(() => toolsApi.cancelAppointment(current.id, a.id))} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-white/10 hover:text-red-300">
                        <X size={13} /> Cancel
                      </button>
                    ) : <span className="text-xs text-muted">Cancelled</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Orders (${orders.length})`} icon={Package} i={5}
            action={
              <button onClick={() => act(() => toolsApi.loadDemoOrders(current.id))} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-white/5">
                Load demo orders
              </button>
            }>
            {orders.length === 0 ? (
              <p className="text-sm text-muted">Connect your shop system later, or load demo orders to try the order-lookup tool.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted">
                    <tr><th className="pb-2 font-normal">Order</th><th className="pb-2 font-normal">Status</th><th className="pb-2 font-normal">Customer</th><th className="pb-2 text-right font-normal">Total</th></tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-t border-line">
                        <td className="py-2.5 font-mono">#{o.order_number}</td>
                        <td className="py-2.5 capitalize">{o.status}</td>
                        <td className="py-2.5 text-muted">{o.customer_email ?? o.customer_phone}</td>
                        <td className="py-2.5 text-right font-mono">{o.total} {o.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className={clsx("fixed bottom-6 right-6 z-50 flex max-w-md items-center gap-3 rounded-2xl border p-4 text-sm shadow-2xl backdrop-blur",
              toast.ok ? "border-emerald-400/30 bg-[#0d1a14]/95" : "border-red-400/30 bg-[#1a0f12]/95")}
          >
            {toast.ok ? <Check size={18} className="text-emerald-300" /> : <X size={18} className="text-red-300" />}
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
