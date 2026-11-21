"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useState } from "react";
import clsx from "clsx";
import { AlertCircle, Check, CheckCheck, Clock, FileText, Globe, Type, Zap } from "lucide-react";
import { isRtlText, RTL_LANGS, type ChatSource, type ChatStats, type Delivery, type ToolCall } from "@/lib/chat";
import { ToolCard } from "./ToolCard";

export type UiMessage = {
  key: string;
  role: "user" | "assistant" | "staff";
  author?: string | null; // staff replies
  content: string;
  language?: string | null;
  sources?: ChatSource[]; // cited passages (after done)
  retrieved?: ChatSource[]; // all passages given to the model (while streaming)
  stats?: ChatStats;
  tools?: ToolCall[];
  streaming?: boolean;
  error?: string;
  delivery?: Delivery | null; // WhatsApp ticks
};

const TICKS: Record<Delivery, { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "text-muted" },
  delivered: { label: "Delivered", cls: "text-muted" },
  read: { label: "Read", cls: "text-cyan" },
  failed: { label: "Not delivered", cls: "text-red-300" },
};

/** WhatsApp-style ticks: ✓ sent, ✓✓ delivered, blue ✓✓ read. They pop in as the status changes. */
function DeliveryTicks({ delivery }: { delivery: Delivery }) {
  const t = TICKS[delivery];
  const Icon = delivery === "failed" ? AlertCircle : delivery === "sent" ? Check : CheckCheck;
  return (
    <span className={clsx("inline-flex items-center gap-1 font-mono text-[11px]", t.cls)} title={`WhatsApp: ${t.label}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={delivery} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }} className="inline-flex">
          <Icon size={13} />
        </motion.span>
      </AnimatePresence>
      {t.label}
    </span>
  );
}

const LANG_LABEL: Record<string, string> = {
  en: "English", tr: "Türkçe", de: "Deutsch", ru: "Русский", fr: "Français", ar: "العربية", fa: "فارسی", ur: "اردو",
};
const sourceIcon = { pdf: FileText, url: Globe, text: Type } as Record<string, typeof FileText>;

type CiteProps = { sources: ChatSource[]; onCite: (n: number) => void };

/** Minimal, safe markdown for chat answers: paragraphs, "- " / "1." lists, **bold**,
 *  plus clickable [n] citation chips. No HTML is ever injected. */
function RichText({ text, ...cite }: { text: string } & CiteProps) {
  const blocks: { type: "p" | "ul" | "ol"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const type = bullet ? "ul" : numbered ? "ol" : "p";
    const content = bullet?.[1] ?? numbered?.[1] ?? line;
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ type: "p", lines: [] }); // paragraph break
    } else if (last && last.type === type && (type !== "p" || last.lines.length)) {
      last.lines.push(content);
    } else {
      blocks.push({ type, lines: [content] });
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.filter((b) => b.lines.length).map((b, i) =>
        b.type === "p" ? (
          <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} {...cite} /></Fragment>)}</p>
        ) : (
          <Fragment key={i}>
            {b.type === "ul" ? (
              <ul className="flex list-disc flex-col gap-1 ps-5 marker:text-accent">
                {b.lines.map((l, j) => <li key={j}><Inline text={l} {...cite} /></li>)}
              </ul>
            ) : (
              <ol className="flex list-decimal flex-col gap-1 ps-5 marker:text-accent">
                {b.lines.map((l, j) => <li key={j}><Inline text={l} {...cite} /></li>)}
              </ol>
            )}
          </Fragment>
        ),
      )}
    </div>
  );
}

function Inline({ text, ...cite }: { text: string } & CiteProps) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i} className="font-semibold text-foreground"><WithCitations text={p.slice(2, -2)} {...cite} /></strong>
        ) : (
          <WithCitations key={i} text={p} {...cite} />
        ),
      )}
    </>
  );
}

/** Render "[1]" markers as small clickable citation chips. */
function WithCitations({ text, sources, onCite }: { text: string } & CiteProps) {
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
      {msg.role === "staff" ? (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan text-xs font-bold text-black" title={msg.author ?? "Team"}>
          {(msg.author ?? "T").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
        </div>
      ) : (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-violet text-sm font-bold text-black">R</div>
      )}
      <div className="min-w-0 max-w-[82%] flex-1">
        {msg.role === "staff" && (
          <p className="mb-1 flex items-center gap-2 text-xs text-emerald-300">
            {msg.author ?? "Team member"} <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">Team</span>
          </p>
        )}
        {msg.tools && msg.tools.length > 0 && (
          <div className="mb-2.5 flex flex-col items-start gap-2 [&>*]:w-full [&>*]:max-w-md">
            {msg.tools.map((t) => <ToolCard key={t.id} call={t} />)}
          </div>
        )}
        {(msg.content || msg.error || !msg.tools?.length || msg.streaming) && (
        <div
          dir={rtl ? "rtl" : "ltr"}
          className={clsx(
            "rounded-3xl rounded-ss-md border px-5 py-3.5 text-base leading-relaxed",
            msg.error ? "border-red-400/30 bg-red-400/10 text-red-200"
              : msg.role === "staff" ? "border-emerald-400/25 bg-emerald-400/[0.07]" : "border-line bg-white/[0.04]",
          )}
        >
          {msg.error ? (
            msg.error
          ) : msg.content ? (
            <RichText text={msg.content} sources={sources} onCite={(n) => setOpen(open === n ? null : n)} />
          ) : (
            <span className="inline-flex gap-1 py-1">
              {[0, 1, 2].map((d) => (
                <motion.span key={d} className="h-2 w-2 rounded-full bg-muted" animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }} />
              ))}
            </span>
          )}
          {msg.streaming && msg.content && <span className="ms-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" />}
        </div>
        )}
        {msg.delivery && <div className="mt-1.5 flex justify-end pe-1"><DeliveryTicks delivery={msg.delivery} /></div>}

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
