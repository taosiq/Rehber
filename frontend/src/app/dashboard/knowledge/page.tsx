"use client";

import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Building2, Layers, Library, Loader2, X } from "lucide-react";
import { api, type DocumentItem } from "@/lib/api";
import { useTenant } from "@/components/dashboard/TenantContext";
import { UploadPanel } from "@/components/dashboard/UploadPanel";
import { DocumentList } from "@/components/dashboard/DocumentList";
import { SearchTester } from "@/components/dashboard/SearchTester";

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 20 });
  const rounded = useTransform(spring, (v) => Math.round(v).toLocaleString());
  useEffect(() => { mv.set(value); }, [mv, value]);
  return <motion.span>{rounded}</motion.span>;
}

function Stat({ icon: Icon, label, value, i }: { icon: typeof Layers; label: string; value: number; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + i * 0.07 }}
      className="rounded-2xl border border-line bg-card p-5 backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 text-sm text-muted"><Icon size={16} className="text-accent" />{label}</div>
      <p className="mt-2 font-display text-5xl"><AnimatedNumber value={value} /></p>
    </motion.div>
  );
}

function CreateFirstBusiness() {
  const { create, error } = useTenant();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-[80vh] place-items-center px-6">
      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await create(name.trim()); } finally { setBusy(false); } }}
        className="glow-border w-full max-w-lg rounded-3xl bg-[#0d0d14]/90 p-10"
      >
        <Building2 className="text-accent" size={32} />
        <h1 className="mt-5 font-display text-5xl">Create your business</h1>
        <p className="mt-2 text-muted">Each business gets its own private knowledge base and AI agent.</p>
        {error && <p className="mt-4 flex items-center gap-2 text-sm text-red-300"><AlertCircle size={16} />{error}</p>}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          required
          placeholder="e.g. Lumen Dental Istanbul"
          className="mt-6 w-full rounded-xl border border-line bg-white/[0.03] px-4 py-3.5 text-lg outline-none placeholder:text-muted/60 focus:border-accent"
        />
        <button disabled={busy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-black disabled:opacity-60">
          {busy && <Loader2 size={18} className="animate-spin" />} Continue
        </button>
      </motion.form>
    </div>
  );
}

export default function KnowledgePage() {
  const { current, loading, error: tenantError } = useTenant();
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const tid = current?.id;

  const refresh = useCallback(async () => {
    if (!tid) return;
    try {
      setDocs(await api.listDocuments(tid));
    } catch (e) {
      setToast((e as Error).message);
    }
  }, [tid]);

  useEffect(() => {
    let alive = true;
    if (tid) api.listDocuments(tid).then((d) => alive && setDocs(d)).catch((e: Error) => alive && setToast(e.message));
    return () => { alive = false; };
  }, [tid]);

  // Poll while anything is still being indexed.
  const indexing = docs.some((d) => d.status === "pending" || d.status === "processing");
  useEffect(() => {
    if (!indexing) return;
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [indexing, refresh]);

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setToast((e as Error).message);
    }
    await refresh();
  }, [refresh]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;
  }
  if (!current) return <CreateFirstBusiness />;

  const ready = docs.filter((d) => d.status === "ready");
  const chunks = ready.reduce((n, d) => n + d.chunk_count, 0);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">Knowledge base</p>
        <h1 className="mt-2 font-display text-5xl md:text-6xl">
          Teach <span className="italic text-gradient">{current.name}</span>&apos;s agent
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          Everything you add here becomes searchable knowledge. The agent answers only from these sources and cites them.
        </p>
      </motion.header>

      {tenantError && <p className="mt-4 text-red-300">{tenantError}</p>}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={Library} label="Documents" value={docs.length} i={0} />
        <Stat icon={Layers} label="Searchable chunks" value={chunks} i={1} />
        <Stat icon={Building2} label="Ready" value={ready.length} i={2} />
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-6">
          <UploadPanel
            onFiles={async (files) => { for (const f of files) await guard(() => api.uploadPdf(current.id, f)); }}
            onUrl={(url) => guard(() => api.addUrl(current.id, url))}
            onText={(title, text) => guard(() => api.addText(current.id, title, text))}
          />
          <div>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-medium">
              Sources
              {indexing && <span className="inline-flex items-center gap-1.5 text-sm font-normal text-cyan"><Loader2 size={14} className="animate-spin" />indexing</span>}
            </h2>
            <DocumentList
              docs={docs}
              onDelete={(id) => guard(() => api.deleteDocument(current.id, id))}
              onRetry={(id) => guard(() => api.reprocess(current.id, id))}
            />
          </div>
        </section>
        <aside className="xl:sticky xl:top-8 xl:self-start">
          <SearchTester tenantId={current.id} disabled={ready.length === 0} />
        </aside>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-3 rounded-2xl border border-red-400/30 bg-[#1a0f12]/95 p-4 text-sm shadow-2xl backdrop-blur"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-300" />
            <p className="flex-1">{toast}</p>
            <button onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} className="text-muted" /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
