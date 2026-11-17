"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, FileText, Globe, Inbox, Loader2, RotateCw, Trash2, Type } from "lucide-react";
import type { DocumentItem, DocStatus } from "@/lib/api";

const sourceIcon = { pdf: FileText, url: Globe, text: Type };

const statusStyle: Record<DocStatus, { label: string; cls: string }> = {
  pending: { label: "Queued", cls: "border-white/10 bg-white/5 text-muted" },
  processing: { label: "Indexing", cls: "border-cyan/30 bg-cyan/10 text-cyan" },
  ready: { label: "Ready", cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  failed: { label: "Failed", cls: "border-red-400/30 bg-red-400/10 text-red-300" },
};

function StatusBadge({ status }: { status: DocStatus }) {
  const s = statusStyle[status];
  const busy = status === "pending" || status === "processing";
  return (
    <span className={clsx("relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1 text-xs font-medium", s.cls)}>
      {busy && <Loader2 size={12} className="animate-spin" />}
      {status === "ready" && <CheckCircle2 size={12} />}
      {status === "failed" && <AlertTriangle size={12} />}
      {s.label}
      {busy && (
        <motion.span
          className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent"
          animate={{ x: ["-100%", "250%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        />
      )}
    </span>
  );
}

export function DocumentList({
  docs,
  onDelete,
  onRetry,
}: {
  docs: DocumentItem[];
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!docs.length) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line py-16 text-center text-muted">
        <Inbox size={32} />
        <p className="text-lg text-foreground">No knowledge yet</p>
        <p className="text-sm">Upload a PDF, add a web page or paste text to teach your agent.</p>
      </motion.div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {docs.map((d) => {
          const Icon = sourceIcon[d.source_type];
          return (
            <motion.li
              key={d.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="group flex items-center gap-4 rounded-2xl border border-line bg-card px-5 py-4 backdrop-blur-xl transition-colors hover:bg-white/[0.05]"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.04]">
                <Icon size={19} className="text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium" title={d.title}>{d.title}</p>
                <p className={clsx("truncate text-sm", d.status === "failed" ? "text-red-300/80" : "text-muted")}>
                  {d.status === "failed"
                    ? d.error
                    : d.status === "ready"
                      ? `${d.chunk_count} chunk${d.chunk_count === 1 ? "" : "s"} · ${(d.char_count / 1000).toFixed(1)}k characters${d.source_type === "url" && d.source_uri ? " · " + new URL(d.source_uri).hostname : ""}`
                      : "Extracting text and creating embeddings…"}
                </p>
              </div>
              <StatusBadge status={d.status} />
              <div className="flex items-center gap-1">
                {d.status === "failed" && d.source_type !== "text" && (
                  <IconButton label="Retry" onClick={() => onRetry(d.id)}><RotateCw size={16} /></IconButton>
                )}
                {confirming === d.id ? (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={async () => { await onDelete(d.id); setConfirming(null); }}
                    onMouseLeave={() => setConfirming(null)}
                    className="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Delete?
                  </motion.button>
                ) : (
                  <IconButton label="Delete" onClick={() => setConfirming(d.id)}><Trash2 size={16} /></IconButton>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted opacity-60 transition-all hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
    >
      {children}
    </button>
  );
}
