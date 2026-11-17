"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { MessageCircle, Plug, Upload } from "lucide-react";
import { SectionHeading } from "./Features";

const steps = [
  { icon: Upload, title: "Upload knowledge", body: "Drop in PDFs or paste your website. We chunk, embed and index it in minutes." },
  { icon: Plug, title: "Connect tools", body: "Switch on bookings, order lookup and human handoff, then point them at your systems." },
  { icon: MessageCircle, title: "Go live", body: "Paste one script tag on your site. WhatsApp is next." },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section id="how" className="container-wide py-28">
      <SectionHeading eyebrow="How it works" title="From PDF to live agent" accent="in three steps." />
      <div ref={ref} className="relative mt-16 grid gap-10 md:grid-cols-3">
        {/* Progress line that draws as you scroll */}
        <div className="absolute left-0 right-0 top-7 hidden h-px bg-line md:block" />
        <motion.div
          style={{ scaleX: lineScale }}
          className="absolute left-0 right-0 top-7 hidden h-px origin-left bg-gradient-to-r from-accent via-violet to-cyan md:block"
        />
        {steps.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: i * 0.15, duration: 0.6 }}
            className="relative"
          >
            <div className="relative z-10 grid h-14 w-14 place-items-center rounded-full border border-line bg-background">
              <s.icon size={18} className="text-accent" />
            </div>
            <p className="mt-6 font-mono text-xs text-muted">0{i + 1}</p>
            <h3 className="mt-1 text-2xl font-medium">{s.title}</h3>
            <p className="mt-3 max-w-sm text-base leading-relaxed text-muted">{s.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
