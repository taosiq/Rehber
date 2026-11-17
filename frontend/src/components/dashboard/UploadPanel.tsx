"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import clsx from "clsx";
import { FileUp, Globe, Loader2, Type, UploadCloud } from "lucide-react";

type Tab = "pdf" | "url" | "text";

const tabs: { id: Tab; label: string; icon: typeof FileUp }[] = [
  { id: "pdf", label: "PDF files", icon: FileUp },
  { id: "url", label: "Website", icon: Globe },
  { id: "text", label: "Paste text", icon: Type },
];

export function UploadPanel({
  onFiles,
  onUrl,
  onText,
}: {
  onFiles: (files: File[]) => Promise<void>;
  onUrl: (url: string) => Promise<void>;
  onText: (title: string, text: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("pdf");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const takeFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (files.length) run(() => onFiles(files));
  };

  return (
    <div className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
      <div className="mb-5 flex gap-1 rounded-2xl bg-white/[0.03] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors",
              tab === t.id ? "text-black" : "text-muted hover:text-foreground",
            )}
          >
            {tab === t.id && (
              <motion.span layoutId="upload-tab" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
            )}
            <t.icon size={16} className="relative" />
            <span className="relative font-medium">{t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
          {tab === "pdf" && (
            <motion.button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}
              animate={{ scale: dragging ? 1.015 : 1 }}
              className={clsx(
                "group flex h-56 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors",
                dragging ? "border-accent bg-accent/10" : "border-line hover:border-accent/50 hover:bg-white/[0.02]",
              )}
            >
              <motion.div
                animate={dragging ? { y: -6, rotate: -6 } : { y: [0, -5, 0] }}
                transition={dragging ? { type: "spring" } : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="grid h-16 w-16 place-items-center rounded-2xl border border-line bg-white/[0.04]"
              >
                {busy ? <Loader2 className="animate-spin text-accent" size={28} /> : <UploadCloud className="text-accent" size={28} />}
              </motion.div>
              <p className="text-lg font-medium">{dragging ? "Drop to upload" : "Drag PDFs here or click to browse"}</p>
              <p className="text-sm text-muted">Up to 20 MB each · menus, price lists, FAQs, policies</p>
              <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => { takeFiles(e.target.files); e.target.value = ""; }} />
            </motion.button>
          )}

          {tab === "url" && (
            <form
              onSubmit={(e) => { e.preventDefault(); if (url.trim()) run(async () => { await onUrl(url.trim()); setUrl(""); }); }}
              className="flex h-56 flex-col justify-center gap-4"
            >
              <label className="text-sm text-muted">Page address (e.g. your FAQ or pricing page)</label>
              <div className="flex gap-3">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  type="url"
                  required
                  placeholder="https://yourbusiness.com/faq"
                  className="min-w-0 flex-1 rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-base outline-none placeholder:text-muted/60 focus:border-accent"
                />
                <SubmitButton busy={busy} label="Add page" />
              </div>
            </form>
          )}

          {tab === "text" && (
            <form
              onSubmit={(e) => { e.preventDefault(); if (title.trim() && text.trim()) run(async () => { await onText(title.trim(), text.trim()); setTitle(""); setText(""); }); }}
              className="flex flex-col gap-3"
            >
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="Title, e.g. Opening hours"
                className="rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-base outline-none placeholder:text-muted/60 focus:border-accent"
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                rows={4}
                placeholder="Paste any text your customers might ask about…"
                className="resize-none rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-base outline-none placeholder:text-muted/60 focus:border-accent"
              />
              <div className="flex justify-end"><SubmitButton busy={busy} label="Add text" /></div>
            </form>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-base font-semibold text-black transition-transform hover:scale-[1.02] disabled:opacity-60"
    >
      {busy && <Loader2 size={16} className="animate-spin" />}
      {label}
    </button>
  );
}
