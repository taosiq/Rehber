"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useState } from "react";
import clsx from "clsx";
import { Clock, FileText, Globe, Type, Zap } from "lucide-react";
import { isRtlText, RTL_LANGS, type ChatSource, type ChatStats } from "@/lib/chat";

export type UiMessage = {
  key: string;
  role: "user" | "assistant";
  content: string;
  language?: string | null;
  sources?: ChatSource[]; // cited passages (after done)
  retrieved?: ChatSource[]; // all passages given to the model (while streaming)
  stats?: ChatStats;
  streaming?: boolean;
  error?: string;
};

const LANG_LABEL: Record<string, string> = {
  en: "English", tr: "Türkçe", de: "Deutsch", ru: "Русский", fr: "Français", ar: "العربية", fa: "فارسی", ur: "اردو",
};
const sourceIcon = { pdf: FileText, url: Globe, text: Type } as Record<string, typeof FileText>;

/** Render "[1]" markers as small clickable citation chips. */
function WithCitations({ text, sources, onCite }: { text: string; sources: ChatSource[]; onCite: (n: number) => void }) {
  const known = new Set(sources.map((s) => s.n));
  const parts = text.split(/(\[\d+(?:\s*,\s*\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[(.+)\]$/);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const nums = m[1].split(",").map((x) => parseInt(x.trim(), 10));
        return (
          <span key={i} className="mx-0.5 inline-flex gap-0.5 align-super">
            {nums.map((n) =>
              known.has(n) ? (
                <button
                  key={n}
                  onClick={() => onCite(n)}
                  className="grid h-[18px] min-w-[18px] place-items-center rounded-md bg-accent/20 px-1 font-mono text-[10px] font-semibold leading-none text-accent transition-colors hover:bg-accent hover:text-black"
                >
                  {n}
                </button>
              ) : (
                <span key={n} className="font-mono text-[10px] text-muted">{n}</span>
              ),
            )}
          </span>
        );
      })}
    </>
  );
}

export function MessageBubble({ msg }: { msg: UiMessage }) {
  const [open, setOpen] = useState<number | null>(null);
  const rtl = msg.language ? RTL_LANGS.has(msg.language) : isRtlText(msg.content);
  const sources = msg.sources ?? msg.retrieved ?? [];
  const shown = sources.find((s) => s.n === open);

  if (msg.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="flex justify-end"
      >
        <div dir={rtl ? "rtl" : "ltr"} className="max-w-[75%] whitespace-pre-wrap rounded-3xl rounded-ee-md bg-gradient-to-br from-violet to-violet/70 px-5 py-3.5 text-base leading-relaxed text-white shadow-[0_10px_40px_-15px_rgba(139,92,246,0.8)]">
          {msg.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="flex gap-3">
      <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-violet text-sm font-bold text-black">R</div>
      <div className="min-w-0 max-w-[82%] flex-1">
        <div
          dir={rtl ? "rtl" : "ltr"}
          className={clsx(
            "whitespace-pre-wrap rounded-3xl rounded-ss-md border px-5 py-3.5 text-base leading-relaxed",
            msg.error ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-line bg-white/[0.04]",
          )}
        >
          {msg.error ? (
            msg.error
          ) : msg.content ? (
            <WithCitations text={msg.content} sources={sources} onCite={(n) => setOpen(open === n ? null : n)} />
          ) : (
            <span className="inline-flex gap-1 py-1">
              {[0, 1, 2].map((d) => (
                <motion.span key={d} className="h-2 w-2 rounded-full bg-muted" animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }} />
              ))}
            </span>
          )}
          {msg.streaming && msg.content && <span className="ms-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" />}
        </div>

        {/* Expanded source passage */}
        <AnimatePresence>
          {shown && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 rounded-2xl border border-accent/25 bg-accent/[0.06] p-4">
                <p className="mb-1.5 font-mono text-[11px] text-accent">
                  [{shown.n}] {shown.document_title}{shown.page ? ` · page ${shown.page}` : ""} · relevance {shown.score.toFixed(2)}
                </p>
                <p dir={isRtlText(shown.content) ? "rtl" : "ltr"} className="text-sm leading-relaxed text-foreground/80">{shown.content}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cited sources + stats */}
        {!msg.streaming && !msg.error && (msg.sources?.length || msg.stats) ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {msg.sources?.map((s, i) => {
              const Icon = sourceIcon[s.source_type] ?? FileText;
              return (
                <motion.button
                  key={s.n}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 + i * 0.07 }}
                  onClick={() => setOpen(open === s.n ? null : s.n)}
                  className={clsx(
                    "inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                    open === s.n ? "border-accent bg-accent text-black" : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20",
                  )}
                >
                  <Icon size={11} className="shrink-0" />
                  <span className="truncate">{s.n}. {s.document_title}{s.page ? ` · p.${s.page}` : ""}</span>
                </motion.button>
              );
            })}
            {msg.stats && (
              <span className="ms-1 inline-flex items-center gap-3 font-mono text-[11px] text-muted">
                {msg.language && <span>{LANG_LABEL[msg.language] ?? msg.language}</span>}
                {msg.stats.first_token_ms != null && (
                  <span className="inline-flex items-center gap-1" title="Time to first word"><Zap size={11} />{(msg.stats.first_token_ms / 1000).toFixed(2)}s</span>
                )}
                <span className="inline-flex items-center gap-1" title="Total time"><Clock size={11} />{(msg.stats.latency_ms / 1000).toFixed(2)}s</span>
                <span title="Tokens in / out">{msg.stats.prompt_tokens}→{msg.stats.completion_tokens} tok</span>
              </span>
            )}
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}
