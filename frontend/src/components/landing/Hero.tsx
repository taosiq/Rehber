"use client";

import Link from "next/link";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { ArrowRight, Sparkles } from "lucide-react";
import { ChatDemo } from "./ChatDemo";

const headline = ["Support", "that", "speaks", "your", "customers'"];

export function Hero() {
  // Gentle 3D tilt of the chat card following the mouse
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [6, -6]), { stiffness: 120, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 120, damping: 18 });

  return (
    <section
      className="relative isolate overflow-hidden pt-36 pb-24 md:pt-44"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
    >
      {/* Background layers */}
      <div className="bg-grid absolute inset-0 -z-10" />
      <div className="aurora-blob -z-10 left-[-10%] top-[-10%] h-[520px] w-[520px] bg-violet" />
      <div className="aurora-blob -z-10 right-[-8%] top-[10%] h-[420px] w-[420px] bg-accent/70 [animation-delay:-6s]" />
      <div className="aurora-blob -z-10 left-[30%] bottom-[-20%] h-[380px] w-[380px] bg-cyan/50 [animation-delay:-12s]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-b from-transparent to-background" />

      <div className="mx-auto grid max-w-6xl items-center gap-16 px-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1 text-xs text-muted backdrop-blur"
          >
            <Sparkles size={12} className="text-accent" /> AI support agents, grounded in your documents
          </motion.span>

          <h1 className="mt-6 font-display text-5xl leading-[1.02] tracking-tight md:text-7xl">
            {headline.map((w, i) => (
              <motion.span
                key={w}
                className="mr-[0.25em] inline-block"
                initial={{ opacity: 0, y: 40, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.2 + i * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                {w}
              </motion.span>
            ))}
            <motion.span
              className="text-gradient inline-block italic"
              initial={{ opacity: 0, y: 40, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.2 + headline.length * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              language.
            </motion.span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-muted"
          >
            Upload your PDFs and web pages. Rehber answers customers with cited sources, books
            appointments, checks orders and hands tricky cases to your team in English, Turkish,
            Arabic and Urdu.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.95, duration: 0.6 }}
            className="mt-10 flex flex-wrap items-center gap-4"
          >
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-black shadow-[0_0_40px_-6px_rgba(245,181,68,0.7)] transition-transform hover:scale-[1.03]"
            >
              Build your agent
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <a href="#how" className="rounded-full border border-line px-6 py-3 text-sm text-foreground/90 transition-colors hover:bg-white/5">
              See how it works
            </a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{ rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
          className="flex justify-center lg:justify-end"
        >
          <ChatDemo />
        </motion.div>
      </div>
    </section>
  );
}
