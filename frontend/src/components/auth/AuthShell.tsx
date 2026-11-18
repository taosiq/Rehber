"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { CalendarCheck, FileText, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/landing/Logo";

const bubbles = [
  { text: "Cumartesi açık mısınız?", side: "right", delay: 0.4 },
  { text: "Evet, 09:00–14:00 arası açığız.", side: "left", delay: 1.1, chip: "hours.pdf" },
  { text: "Can I book Friday 14:00?", side: "right", delay: 1.9 },
  { text: "Booked. Your code is RB-VL4WW.", side: "left", delay: 2.6, tool: true },
];

/** Split-screen layout shared by login and sign-up. */
export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <main className="relative grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="bg-grid pointer-events-none fixed inset-0 -z-10 opacity-60" />

      {/* Brand panel */}
      <section className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="aurora-blob -z-10 left-[-10%] top-[-10%] h-[520px] w-[520px] bg-violet" />
        <div className="aurora-blob -z-10 bottom-[-15%] right-[-10%] h-[420px] w-[420px] bg-accent/60 [animation-delay:-7s]" />
        <Link href="/"><Logo size={44} /></Link>

        <div className="mx-auto flex w-full max-w-md flex-col gap-3">
          {bubbles.map((b, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: [0, -4, 0], scale: 1 }}
              transition={{
                opacity: { delay: b.delay, duration: 0.5 },
                scale: { delay: b.delay, duration: 0.5 },
                y: { delay: b.delay + 0.5, duration: 4 + i, repeat: Infinity, ease: "easeInOut" },
              }}
              className={b.side === "right" ? "flex justify-end" : "flex flex-col items-start gap-1.5"}
            >
              <span className={b.side === "right"
                ? "rounded-2xl rounded-ee-sm bg-gradient-to-br from-violet to-violet/70 px-4 py-2.5 text-sm text-white"
                : "rounded-2xl rounded-ss-sm border border-line bg-white/[0.05] px-4 py-2.5 text-sm backdrop-blur"}>
                {b.text}
              </span>
              {b.chip && (
                <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent">
                  <FileText size={10} /> {b.chip}
                </span>
              )}
              {b.tool && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                  <CalendarCheck size={10} /> book_appointment ✓
                </span>
              )}
            </motion.div>
          ))}
        </div>

        <p className="flex items-center gap-2 text-sm text-muted">
          <ShieldCheck size={16} className="text-accent" />
          Argon2id passwords · HttpOnly sessions · every business isolated
        </p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-6 py-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <Link href="/" className="mb-10 inline-block lg:hidden"><Logo size={40} /></Link>
          <h1 className="font-display text-5xl leading-tight">{title}</h1>
          <p className="mt-2 text-lg text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-8 text-center text-sm text-muted">{footer}</p>
        </motion.div>
      </section>
    </main>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted">{label}</span>
      {children}
      {hint}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-white/[0.03] px-4 py-3.5 text-base outline-none transition-colors placeholder:text-muted/50 focus:border-accent focus:bg-white/[0.05]";

/** Only allow redirects to pages on this site (prevents open-redirect phishing). */
export function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}
