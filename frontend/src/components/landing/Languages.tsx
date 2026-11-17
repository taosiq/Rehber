"use client";

import { motion } from "motion/react";
import { SectionHeading } from "./Features";

const greetings = [
  { text: "How can I help you today?", lang: "English", rtl: false },
  { text: "Bugün size nasıl yardımcı olabilirim?", lang: "Türkçe", rtl: false },
  { text: "كيف يمكنني مساعدتك اليوم؟", lang: "العربية", rtl: true },
  { text: "آج میں آپ کی کیا مدد کر سکتا ہوں؟", lang: "اردو", rtl: true },
];

/** Infinite marquee of greetings in all supported languages. */
export function Languages() {
  const row = [...greetings, ...greetings];
  return (
    <section id="languages" className="py-28">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading eyebrow="Languages" title="One agent." accent="Every customer, in their own words." />
      </div>
      <div className="relative mt-14 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <motion.div
          className="flex w-max gap-4"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 28, ease: "linear", repeat: Infinity }}
        >
          {row.map((g, i) => (
            <div key={i} className="flex shrink-0 items-center gap-4 rounded-2xl border border-line bg-card px-6 py-5">
              <span className="rounded-md bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent">{g.lang}</span>
              <span dir={g.rtl ? "rtl" : "ltr"} className="font-display text-2xl">{g.text}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
