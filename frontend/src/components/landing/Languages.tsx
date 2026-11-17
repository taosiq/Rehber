"use client";

import { motion } from "motion/react";
import { SectionHeading } from "./Features";

const greetings = [
  { text: "How can I help you today?", lang: "English", rtl: false },
  { text: "Bugün size nasıl yardımcı olabilirim?", lang: "Türkçe", rtl: false },
  { text: "كيف يمكنني مساعدتك اليوم؟", lang: "العربية", rtl: true },
  { text: "آج میں آپ کی کیا مدد کر سکتا ہوں؟", lang: "اردو", rtl: true },
  { text: "Wie kann ich Ihnen heute helfen?", lang: "Deutsch", rtl: false },
  { text: "Чем я могу вам помочь сегодня?", lang: "Русский", rtl: false },
  { text: "Comment puis-je vous aider aujourd'hui ?", lang: "Français", rtl: false },
  { text: "امروز چطور می‌توانم کمکتان کنم؟", lang: "فارسی", rtl: true },
];

/** Infinite marquee of greetings in all supported languages. */
export function Languages() {
  const row = [...greetings, ...greetings];
  return (
    <section id="languages" className="py-28">
      <div className="container-wide">
        <SectionHeading eyebrow="Languages" title="One agent." accent="Every customer, in their own words." />
      </div>
      <div className="relative mt-14 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <motion.div
          className="flex w-max gap-4"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 55, ease: "linear", repeat: Infinity }}
        >
          {row.map((g, i) => (
            <div key={i} className="flex shrink-0 items-center gap-4 rounded-2xl border border-line bg-card px-8 py-6">
              <span className="rounded-md bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent">{g.lang}</span>
              <span dir={g.rtl ? "rtl" : "ltr"} className="font-display text-3xl">{g.text}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
