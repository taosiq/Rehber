"use client";

import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { BarChart3, Building2, FileSearch, Gauge, Languages, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

type Feature = { icon: LucideIcon; title: string; body: string; span?: string };

const features: Feature[] = [
  { icon: FileSearch, title: "Answers with receipts", body: "Retrieval over your PDFs and pages with pgvector. Every reply cites the exact document and page it came from.", span: "md:col-span-2" },
  { icon: Wrench, title: "Agents that act", body: "LangGraph tools book appointments, look up orders and hand over to a human when it matters." },
  { icon: Languages, title: "8 languages, RTL-ready", body: "Türkçe, English, Deutsch, Русский, Français, العربية, فارسی and اردو. Detected automatically, with right-to-left layout where needed." },
  { icon: Building2, title: "Multi-tenant by design", body: "Many businesses on one platform, each with strictly separated data, keys and settings.", span: "md:col-span-2" },
  { icon: Gauge, title: "Streaming & fast", body: "Tokens stream to the widget as they're generated, so customers never stare at a spinner." },
  { icon: BarChart3, title: "Measured, not guessed", body: "Eval test sets score answer quality; Langfuse traces every call with cost and latency per business.", span: "md:col-span-2" },
];

function SpotlightCard({ f, i }: { f: Feature; i: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const bg = useMotionTemplate`radial-gradient(380px circle at ${x}px ${y}px, rgba(245,181,68,0.12), transparent 70%)`;
  const Icon = f.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay: i * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      }}
      className={clsx("group relative overflow-hidden rounded-3xl border border-line bg-card p-9", f.span)}
    >
      <motion.div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: bg }} />
      <div className="relative">
        <div className="mb-6 inline-grid h-14 w-14 place-items-center rounded-xl border border-line bg-white/[0.04] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110">
          <Icon size={26} className="text-accent" />
        </div>
        <h3 className="text-2xl font-medium">{f.title}</h3>
        <p className="mt-3 text-base leading-relaxed text-muted">{f.body}</p>
      </div>
    </motion.div>
  );
}

export function Features() {
  return (
    <section id="features" className="container-wide py-28">
      <SectionHeading eyebrow="Platform" title="Everything a support team needs," accent="nothing it doesn't." />
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {features.map((f, i) => <SpotlightCard key={f.title} f={f} i={i} />)}
      </div>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, accent }: { eyebrow: string; title: string; accent: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="max-w-4xl"
    >
      <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
      <h2 className="mt-4 font-display text-5xl leading-tight md:text-7xl">
        {title} <span className="italic text-muted">{accent}</span>
      </h2>
    </motion.div>
  );
}
