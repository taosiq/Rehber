"use client";

import { motion } from "motion/react";
import clsx from "clsx";
import {
  AlertCircle, CalendarCheck, CalendarClock, CalendarSearch, Check, Hourglass, Loader2, Package, Search, Truck, UserRound,
} from "lucide-react";
import type { ToolCall } from "@/lib/chat";

const LABELS: Record<string, { icon: typeof Package; running: string; done: string }> = {
  search_knowledge: { icon: Search, running: "Searching knowledge", done: "Searched knowledge" },
  check_availability: { icon: CalendarSearch, running: "Checking availability", done: "Checked availability" },
  book_appointment: { icon: CalendarCheck, running: "Booking appointment", done: "Appointment" },
  get_order_status: { icon: Package, running: "Looking up order", done: "Order status" },
  handoff_to_human: { icon: UserRound, running: "Contacting the team", done: "Handed to a human" },
};

type R = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

function Shell({ tone, children }: { tone: "neutral" | "good" | "warn" | "bad" | "violet"; children: React.ReactNode }) {
  const tones = {
    neutral: "border-line bg-white/[0.03]",
    good: "border-emerald-400/30 bg-emerald-400/[0.07]",
    warn: "border-amber-300/30 bg-amber-300/[0.07]",
    bad: "border-red-400/25 bg-red-400/[0.06]",
    violet: "border-violet/40 bg-violet/10",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={clsx("relative overflow-hidden rounded-2xl border p-4", tones[tone])}
    >
      {children}
    </motion.div>
  );
}

function Header({ call, title, tone }: { call: ToolCall; title: string; tone?: string }) {
  const meta = LABELS[call.name] ?? { icon: Search, running: call.name, done: call.name };
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={clsx("grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06]", tone)}>
        {call.status === "running" ? <Loader2 size={14} className="animate-spin text-cyan" /> : <Icon size={14} />}
      </span>
      <span className="font-medium">{title}</span>
    </div>
  );
}

function Slots({ r }: { r: R }) {
  const slots = (r.slots as string[]) ?? [];
  return (
    <div className="mt-3">
      <p className="text-xs text-muted">
        {str(r.weekday)} {str(r.date)} · {str(r.service)} ({str(r.minutes)} min)
      </p>
      {slots.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slots.slice(0, 12).map((t, i) => (
            <motion.span
              key={t}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              className="rounded-lg border border-cyan/25 bg-cyan/10 px-2 py-1 font-mono text-[11px] text-cyan"
            >
              {t}
            </motion.span>
          ))}
          {slots.length > 12 && <span className="px-1 py-1 text-[11px] text-muted">+{slots.length - 12} more</span>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">No free times that day.</p>
      )}
    </div>
  );
}

function BookingTicket({ r }: { r: R }) {
  return (
    <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {[
        ["Service", r.service],
        ["When", `${str(r.weekday)} ${str(r.date)} · ${str(r.time)}–${str(r.end_time)}`],
        ["Name", r.customer_name],
        ["Contact", r.customer_contact],
      ].flatMap(([k, v]) =>
        v
          ? [
              <span key={`${k}-k`} className="text-muted">{String(k)}</span>,
              <span key={`${k}-v`}>{str(v)}</span>,
            ]
          : [],
      )}

    </div>
  );
}

const STEPS = ["processing", "shipped", "delivered"];

function OrderTrack({ r }: { r: R }) {
  const status = str(r.status);
  const idx = STEPS.indexOf(status);
  const items = (r.items as { name: string; qty: number }[]) ?? [];
  return (
    <div className="mt-3 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs text-muted">#{str(r.order_number)}</span>
        <span className="font-mono text-xs">{str(r.total)} {str(r.currency)}</span>
      </div>
      {idx >= 0 ? (
        <div className="mt-3">
          <div className="relative h-1.5 rounded-full bg-white/10">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet to-accent"
              initial={{ width: 0 }}
              animate={{ width: `${(idx / (STEPS.length - 1)) * 100}%` }}
              transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] capitalize">
            {STEPS.map((st, i) => (
              <span key={st} className={i <= idx ? "text-foreground" : "text-muted"}>{st}</span>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 capitalize text-amber-200">{status}</p>
      )}
      <p className="mt-3 text-muted">{items.map((i) => `${i.qty}× ${i.name}`).join(" · ")}</p>
      {Boolean(r.carrier || r.estimated_delivery) && (
        <p className="mt-1 flex items-center gap-1.5 text-muted">
          <Truck size={13} /> {str(r.carrier)} {r.tracking_number ? `· ${str(r.tracking_number)}` : ""}
          {r.estimated_delivery ? ` · ETA ${str(r.estimated_delivery)}` : ""}
        </p>
      )}
    </div>
  );
}

export function ToolCard({ call }: { call: ToolCall }) {
  const r = (call.result ?? {}) as R;
  const meta = LABELS[call.name];

  if (call.status === "running") {
    return (
      <Shell tone="neutral">
        <div className="relative">
          <Header call={call} title={`${meta?.running ?? call.name}…`} />
          <motion.span
            className="pointer-events-none absolute inset-y-0 -left-4 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            animate={{ x: ["0%", "400%"] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          />
        </div>
      </Shell>
    );
  }

  if (call.status === "error") {
    return (
      <Shell tone="bad">
        <div className="flex items-start gap-2 text-sm">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-300" />
          <span><span className="font-medium">{meta?.done ?? call.name}:</span> <span className="text-red-200/90">{str(r.error)}</span></span>
        </div>
      </Shell>
    );
  }

  switch (call.name) {
    case "search_knowledge":
      return (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted">
          <Search size={11} /> Searched “{str(r.query)}” · {str(r.found)} found
        </div>
      );
    case "check_availability":
      return (
        <Shell tone="neutral">
          <Header call={call} title="Free times" tone="text-cyan" />
          <Slots r={r} />
        </Shell>
      );
    case "book_appointment": {
      const pending = Boolean(r.pending);
      return (
        <Shell tone={pending ? "warn" : "good"}>
          <div className="flex items-center gap-2 text-sm">
            <span className={clsx("grid h-7 w-7 place-items-center rounded-lg", pending ? "bg-amber-300/15 text-amber-200" : "bg-emerald-400/15 text-emerald-300")}>
              {pending ? <Hourglass size={14} /> : <Check size={14} />}
            </span>
            <span className="font-medium">{pending ? "Waiting for the customer to confirm" : "Appointment booked"}</span>
            {pending && <CalendarClock size={14} className="ml-auto text-amber-200/70" />}
          </div>
          <BookingTicket r={r} />
          {!pending && r.code ? (
            <motion.div
              initial={{ opacity: 0, scale: 2.2, rotate: -25 }}
              animate={{ opacity: 1, scale: 1, rotate: -8 }}
              transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
              className="absolute right-4 top-12 rounded-lg border-2 border-emerald-300 px-3 py-1 font-mono text-sm font-bold tracking-wider text-emerald-300"
            >
              {str(r.code)}
            </motion.div>
          ) : null}
        </Shell>
      );
    }
    case "get_order_status":
      return (
        <Shell tone="neutral">
          <Header call={call} title="Order status" tone="text-accent" />
          <OrderTrack r={r} />
        </Shell>
      );
    case "handoff_to_human":
      return (
        <Shell tone="violet">
          <div className="flex items-center gap-3 text-sm">
            <motion.span
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="grid h-8 w-8 place-items-center rounded-full bg-violet/30"
            >
              <UserRound size={15} />
            </motion.span>
            <div>
              <p className="font-medium">Handed to a human</p>
              <p className="text-muted">{str(r.reason)}{r.customer_contact ? ` · ${str(r.customer_contact)}` : ""}</p>
            </div>
          </div>
        </Shell>
      );
    default:
      return null;
  }
}
