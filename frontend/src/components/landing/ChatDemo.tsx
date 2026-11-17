"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, FileText, Package, UserRound } from "lucide-react";
import clsx from "clsx";

type Step =
  | { kind: "user"; text: string }
  | { kind: "tool"; icon: "calendar" | "package" | "human"; label: string }
  | { kind: "bot"; text: string; sources?: string[] };

type Script = { lang: string; code: string; rtl?: boolean; business: string; steps: Step[] };

/** Scripted demo conversations, one per supported language. */
const scripts: Script[] = [
  {
    lang: "English", code: "EN", business: "Lumen Dental",
    steps: [
      { kind: "user", text: "Do you do teeth whitening, and can I come in Friday?" },
      { kind: "tool", icon: "calendar", label: "check_availability(Fri)" },
      { kind: "bot", text: "Yes, we offer in-office whitening (60 min, $180). Friday has openings at 10:30 and 15:00. Shall I book one for you?", sources: ["services.pdf · p.3", "pricing.pdf"] },
    ],
  },
  {
    lang: "Türkçe", code: "TR", business: "Kuzey Store",
    steps: [
      { kind: "user", text: "Siparişim nerede? Numara #48213" },
      { kind: "tool", icon: "package", label: "get_order(#48213)" },
      { kind: "bot", text: "Siparişiniz kargoya verildi ve yarın 12:00'den önce teslim edilmesi bekleniyor. Takip kodu: YK-99120.", sources: ["shipping-policy.pdf"] },
    ],
  },
  {
    lang: "العربية", code: "AR", rtl: true, business: "Nakhla Clinic",
    steps: [
      { kind: "user", text: "ما هي ساعات العمل يوم السبت؟" },
      { kind: "bot", text: "نعمل يوم السبت من الساعة ٩ صباحاً حتى ٢ ظهراً. هل تود حجز موعد؟", sources: ["clinic-hours.html"] },
    ],
  },
  {
    lang: "اردو", code: "UR", rtl: true, business: "Saya Fashion",
    steps: [
      { kind: "user", text: "مجھے اپنا آرڈر واپس کرنا ہے، کسی انسان سے بات ہو سکتی ہے؟" },
      { kind: "tool", icon: "human", label: "handoff_to_human()" },
      { kind: "bot", text: "بالکل! میں آپ کو ہماری سپورٹ ٹیم سے جوڑ رہا ہوں۔ واپسی ۱۴ دن کے اندر مفت ہے۔", sources: ["returns.pdf · p.1"] },
    ],
  },
  {
    lang: "Deutsch", code: "DE", business: "Ege Boutique Hotel",
    steps: [
      { kind: "user", text: "Haben Sie für nächste Woche noch ein Doppelzimmer mit Meerblick?" },
      { kind: "tool", icon: "calendar", label: "check_rooms(sea_view)" },
      { kind: "bot", text: "Ja! Von Montag bis Freitag ist ein Doppelzimmer mit Meerblick frei, 145 € pro Nacht inklusive Frühstück. Soll ich es reservieren?", sources: ["rooms.pdf · p.2"] },
    ],
  },
  {
    lang: "Русский", code: "RU", business: "Antalya Smile Clinic",
    steps: [
      { kind: "user", text: "Сколько стоит установка импланта и сколько дней это займёт?" },
      { kind: "bot", text: "Имплант стоит от 450 €. Обычно нужно два визита с перерывом 5–7 дней. Трансфер из отеля бесплатный.", sources: ["implants.pdf · p.4", "transfer.html"] },
    ],
  },
  {
    lang: "Français", code: "FR", business: "Kapadokya Balloons",
    steps: [
      { kind: "user", text: "Le vol en montgolfière de demain est-il confirmé ?" },
      { kind: "tool", icon: "package", label: "get_booking(#CP-2207)" },
      { kind: "bot", text: "Oui, votre vol est confirmé. Prise en charge à votre hôtel à 4h45. Pensez à une veste chaude !", sources: ["faq.pdf · p.1"] },
    ],
  },
  {
    lang: "فارسی", code: "FA", rtl: true, business: "Bosphorus Tours",
    steps: [
      { kind: "user", text: "تور کشتی بسفر چند ساعت طول می‌کشد؟" },
      { kind: "bot", text: "تور کشتی حدود ۲ ساعت است و هر روز ساعت ۱۰ و ۱۴ حرکت می‌کند. بلیت می‌خواهید؟", sources: ["tours.pdf · p.2"] },
    ],
  },
];

const toolIcons = { calendar: CalendarCheck, package: Package, human: UserRound };

/** Reveals text word-by-word, imitating a streamed LLM answer.
 *  Each bot message is a fresh (keyed) component, so the count starts at 0. */
function useStreamedText(text: string, speed = 45) {
  const words = text.split(" ");
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= words.length) { clearInterval(id); return c; }
        return c + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, words.length]);
  return { shown: words.slice(0, count).join(" "), done: count >= words.length };
}

function BotMessage({ step, rtl, onDone }: { step: Extract<Step, { kind: "bot" }>; rtl?: boolean; onDone: () => void }) {
  const { shown, done } = useStreamedText(step.text);
  useEffect(() => { if (done) { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); } }, [done, onDone]);
  return (
    <div className={clsx("flex flex-col gap-2", rtl ? "items-end" : "items-start")}>
      <div dir={rtl ? "rtl" : "ltr"} className="max-w-[85%] rounded-2xl rounded-ss-sm border border-line bg-white/[0.04] px-5 py-3 text-base leading-relaxed">
        {shown}
        {!done && <span className="ms-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" />}
      </div>
      <AnimatePresence>
        {done && step.sources && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap gap-1.5">
            {step.sources.map((s, i) => (
              <motion.span
                key={s}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.12 }}
                className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 font-mono text-[11px] text-accent"
              >
                <FileText size={10} /> {s}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChatDemo() {
  const [scriptIdx, setScriptIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const script = scripts[scriptIdx];

  // Advance through user/tool steps on a timer; bot steps advance when streaming ends.
  useEffect(() => {
    const step = script.steps[stepIdx];
    if (!step || step.kind === "bot") return;
    const t = setTimeout(() => setStepIdx((i) => i + 1), step.kind === "user" ? 1200 : 1400);
    return () => clearTimeout(t);
  }, [script, stepIdx]);

  const nextScript = useCallback(() => { setScriptIdx((i) => (i + 1) % scripts.length); setStepIdx(0); }, []);
  const visible = script.steps.slice(0, stepIdx + 1);
  const waiting = script.steps[stepIdx]?.kind === "user";

  return (
    <div className="glow-border relative w-full max-w-xl rounded-3xl bg-[#0d0d14]/90 shadow-[0_30px_120px_-30px_rgba(139,92,246,0.45)] backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="relative grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-accent to-violet text-sm font-semibold text-black">
            {script.business[0]}
            <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-[#0d0d14] bg-emerald-400" />
          </div>
          <div>
            <AnimatePresence mode="wait">
              <motion.p key={script.business} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-base font-medium">
                {script.business}
              </motion.p>
            </AnimatePresence>
            <p className="text-sm text-muted">AI assistant · replies instantly</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {scripts.map((s, i) => (
            <button
              key={s.code}
              onClick={() => { setScriptIdx(i); setStepIdx(0); }}
              className={clsx(
                "rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors",
                i === scriptIdx ? "bg-accent text-black" : "text-muted hover:text-foreground",
              )}
            >
              {s.code}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex h-[420px] flex-col justify-end gap-3 overflow-hidden px-5 py-5">
        <AnimatePresence mode="popLayout">
          {visible.map((step, i) => (
            <motion.div
              key={`${scriptIdx}-${i}`}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
            >
              {step.kind === "user" && (
                <div className={clsx("flex", script.rtl ? "justify-start" : "justify-end")}>
                  <div dir={script.rtl ? "rtl" : "ltr"} className="max-w-[80%] rounded-2xl rounded-se-sm bg-gradient-to-br from-violet to-violet/70 px-5 py-3 text-base text-white">
                    {step.text}
                  </div>
                </div>
              )}
              {step.kind === "tool" && (() => {
                const Icon = toolIcons[step.icon];
                return (
                  <div className="flex justify-center">
                    <span className="inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3.5 py-1.5 font-mono text-xs text-cyan">
                      <motion.span animate={{ rotate: [0, 360] }} transition={{ duration: 1.4, ease: "linear", repeat: Infinity }} className="inline-flex">
                        <Icon size={12} />
                      </motion.span>
                      {step.label}
                    </span>
                  </div>
                );
              })()}
              {step.kind === "bot" && <BotMessage step={step} rtl={script.rtl} onDone={nextScript} />}
            </motion.div>
          ))}
        </AnimatePresence>
        {waiting && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={clsx("flex gap-1 px-1", script.rtl && "justify-end")}>
            {[0, 1, 2].map((d) => (
              <motion.span key={d} className="h-1.5 w-1.5 rounded-full bg-muted" animate={{ y: [0, -4, 0] }} transition={{ duration: 0.8, repeat: Infinity, delay: d * 0.15 }} />
            ))}
          </motion.div>
        )}
      </div>

      {/* Input (decorative) */}
      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-5 py-3 text-base text-muted">
          <span>Ask anything in {script.lang}…</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
        </div>
      </div>
    </div>
  );
}
