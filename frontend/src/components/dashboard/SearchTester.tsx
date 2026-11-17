"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { FileText, Loader2, Search, Sparkles } from "lucide-react";
import { api, type SearchResponse } from "@/lib/api";

const examples = ["Cumartesi açık mısınız?", "How much does whitening cost?", "ما هي ساعات العمل؟", "Wie kann ich bezahlen?"];

/** Detect right-to-left scripts so Arabic/Persian/Urdu text renders correctly. */
const isRtl = (s: string) => /[֐-ࣿ]/.test(s);

export function SearchTester({ tenantId, disabled }: { tenantId: string; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setBusy(true);
    setError(null);
    try {
      setResult(await api.search(tenantId, q.trim(), 4));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glow-border rounded-3xl bg-[#0d0d14]/80 p-6 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-accent" />
        <h2 className="text-xl font-medium">Test retrieval</h2>
      </div>
      <p className="mt-1 text-sm text-muted">Ask in any language: Rehber finds the most relevant passages from your documents.</p>

      <form onSubmit={(e) => { e.preventDefault(); run(query); }} className="mt-5 flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            dir={isRtl(query) ? "rtl" : "ltr"}
            disabled={disabled}
            placeholder={disabled ? "Add a document first…" : "Ask a customer question…"}
            className="w-full rounded-xl border border-line bg-white/[0.03] py-3 pe-4 ps-11 text-base outline-none placeholder:text-muted/60 focus:border-accent disabled:opacity-50"
          />
        </div>
        <button disabled={disabled || busy} className="grid w-12 place-items-center rounded-xl bg-accent text-black disabled:opacity-50" aria-label="Search">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </button>
      </form>

      {!disabled && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button key={ex} onClick={() => run(ex)} dir={isRtl(ex) ? "rtl" : "ltr"} className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-foreground">
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      <AnimatePresence mode="wait">
        {result && (
          <motion.div key={result.query + result.took_ms} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 flex flex-col gap-3">
            <p className="text-xs text-muted">{result.hits.length} passages · {result.took_ms} ms</p>
            {result.hits.length === 0 && <p className="text-sm text-muted">No matches yet. Upload more documents.</p>}
            {result.hits.map((h, i) => (
              <motion.div
                key={h.chunk_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="rounded-2xl border border-line bg-white/[0.03] p-4"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] text-accent">
                    <FileText size={11} className="shrink-0" />
                    <span className="truncate">{h.document_title}{h.page ? ` · p.${h.page}` : ""}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-violet to-accent"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(4, Math.min(100, h.score * 140))}%` }}
                        transition={{ delay: 0.15 + i * 0.08, duration: 0.6, ease: "easeOut" }}
                      />
                    </div>
                    <span className="w-9 text-right font-mono text-[11px] text-muted">{h.score.toFixed(2)}</span>
                  </div>
                </div>
                <p dir={isRtl(h.content) ? "rtl" : "ltr"} className="line-clamp-4 text-sm leading-relaxed text-foreground/85">{h.content}</p>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
