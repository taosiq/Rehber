"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle, Check, Copy, Globe, KeyRound, Loader2, Lock, Plus, Server, ShieldCheck, Trash2, X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import { useTenant } from "@/components/dashboard/TenantContext";
import { keysApi, type ApiKeyItem } from "@/lib/api";

const inputCls = "w-full rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-base outline-none placeholder:text-muted/50 focus:border-accent";

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";
}

function NewKeyReveal({ value, onClose }: { value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-6 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="glow-border w-full max-w-xl rounded-3xl bg-[#0d0d14] p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300"><KeyRound size={20} /></span>
          <h2 className="font-display text-3xl">Your new key</h2>
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Copy it now. We keep only a one-way fingerprint (hash) of it, so it can <b>never be shown again</b>.
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-black/40 p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-sm text-accent">{value}</code>
          <button
            onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
            {copied ? <><Check size={14} className="text-emerald-300" /> Copied</> : <><Copy size={14} /> Copy</>}
          </button>
        </div>
        <button onClick={onClose} className="mt-6 w-full rounded-xl bg-accent py-3 font-semibold text-black">I&apos;ve saved it</button>
      </motion.div>
    </motion.div>
  );
}

/** API keys for the website widget (publishable) and integrations (secret). */
export function ApiKeysSection() {
  const { me } = useAuth();
  const { current } = useTenant();
  const tid = current?.id;
  const role = me.tenants.find((t) => t.id === tid)?.role ?? "member";
  const canManage = role === "owner" || role === "admin";

  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [kind, setKind] = useState<ApiKeyItem["kind"]>("publishable");
  const [name, setName] = useState("Website widget");
  const [origins, setOrigins] = useState<string[]>([]);
  const [originInput, setOriginInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (tid && canManage) setKeys(await keysApi.list(tid));
  }, [tid, canManage]);

  useEffect(() => {
    let alive = true;
    if (tid && canManage) keysApi.list(tid).then((k) => alive && setKeys(k)).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [tid, canManage]);

  const addOrigin = () => {
    const v = originInput.trim().replace(/\/+$/, "");
    if (!v) return;
    if (!/^https?:\/\/[^/\s]+$/i.test(v)) {
      setError("Enter a website like https://www.yourshop.com (no path).");
      return;
    }
    setOrigins((o) => Array.from(new Set([...o, v.toLowerCase()])));
    setOriginInput("");
    setError(null);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await keysApi.create(tid, { name, kind, allowed_origins: kind === "publishable" ? origins : [] });
      setRevealed(created.key);
      setOrigins([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;

  return (
    <div>
      <div className="grid gap-8 xl:grid-cols-[1.4fr_1fr]">
        <section className="flex flex-col gap-6">
          {!canManage ? (
            <div className="flex items-center gap-3 rounded-3xl border border-line bg-card p-6 text-muted">
              <Lock size={18} /> Only owners and admins can manage API keys. Your role: <b className="text-foreground">{role}</b>
            </div>
          ) : (
            <>
              <motion.form initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                onSubmit={create} className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
                <h2 className="flex items-center gap-2 text-xl font-medium"><Plus size={18} className="text-accent" /> Create a key</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {([
                    { id: "publishable", icon: Globe, title: "Website widget", body: "Safe to put on your site. Can only chat, only from your listed websites." },
                    { id: "secret", icon: Server, title: "Server integration", body: "For your shop system (e.g. order sync). Never put it on a website." },
                  ] as const).map((o) => (
                    <button type="button" key={o.id}
                      onClick={() => { setKind(o.id); setName(o.id === "publishable" ? "Website widget" : "Shop integration"); }}
                      className={clsx("rounded-2xl border p-4 text-left transition-colors",
                        kind === o.id ? "border-accent/60 bg-accent/[0.07]" : "border-line hover:bg-white/[0.03]")}>
                      <o.icon size={20} className={kind === o.id ? "text-accent" : "text-muted"} />
                      <p className="mt-2 font-medium">{o.title}</p>
                      <p className="mt-1 text-sm text-muted">{o.body}</p>
                    </button>
                  ))}
                </div>

                <label className="mt-5 block">
                  <span className="mb-1.5 block text-sm text-muted">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className={inputCls} />
                </label>

                {kind === "publishable" && (
                  <div className="mt-4">
                    <span className="mb-1.5 block text-sm text-muted">Websites allowed to use this key</span>
                    <div className="flex gap-2">
                      <input value={originInput} onChange={(e) => setOriginInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOrigin(); } }}
                        placeholder="https://www.yourshop.com" className={inputCls} />
                      <button type="button" onClick={addOrigin} className="shrink-0 rounded-xl border border-line px-4 hover:bg-white/5">Add</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <AnimatePresence>
                        {origins.map((o) => (
                          <motion.span key={o} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 font-mono text-xs text-cyan">
                            {o}
                            <button type="button" onClick={() => setOrigins((x) => x.filter((y) => y !== o))} aria-label={`Remove ${o}`}><X size={12} /></button>
                          </motion.span>
                        ))}
                      </AnimatePresence>
                      {!origins.length && <span className="text-xs text-muted">Add at least one. For local testing you can add http://localhost:5500</span>}
                    </div>
                  </div>
                )}

                {error && <p className="mt-4 flex items-center gap-2 text-sm text-red-300"><AlertTriangle size={15} />{error}</p>}

                <button disabled={busy || (kind === "publishable" && !origins.length)}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-black disabled:opacity-40">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Create key
                </button>
              </motion.form>

              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
                className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
                <h2 className="flex items-center gap-2 text-xl font-medium"><KeyRound size={18} className="text-accent" /> Keys ({keys.filter((k) => !k.revoked_at).length} active)</h2>
                {keys.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">No keys yet. Create a widget key to put Rehber on your website (Phase 6).</p>
                ) : (
                  <ul className="mt-4 flex flex-col gap-2">
                    {keys.map((k) => (
                      <li key={k.id} className={clsx("flex items-center gap-4 rounded-2xl border px-4 py-3", k.revoked_at ? "border-line opacity-50" : "border-line bg-white/[0.02]")}>
                        <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", k.kind === "publishable" ? "bg-cyan/10 text-cyan" : "bg-violet/20 text-violet-200")}>
                          {k.kind === "publishable" ? <Globe size={17} /> : <Server size={17} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{k.name} <span className="ms-1 font-mono text-xs text-muted">{k.prefix}…</span></p>
                          <p className="truncate text-xs text-muted">
                            {k.kind === "publishable" ? k.allowed_origins.join(", ") : "server-to-server"} · last used {when(k.last_used_at)}
                          </p>
                        </div>
                        {k.revoked_at ? (
                          <span className="text-xs text-muted">Revoked</span>
                        ) : confirming === k.id ? (
                          <button onMouseLeave={() => setConfirming(null)}
                            onClick={async () => { await keysApi.revoke(current.id, k.id); setConfirming(null); await load(); }}
                            className="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white">Revoke now?</button>
                        ) : (
                          <button onClick={() => setConfirming(k.id)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-red-300" aria-label="Revoke key">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
            className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.04] p-6">
            <h2 className="flex items-center gap-2 text-xl font-medium"><ShieldCheck size={18} className="text-emerald-300" /> How your data is protected</h2>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-muted">
              <li>• Passwords hashed with Argon2id. Nobody, including us, can read them.</li>
              <li>• Sessions in HttpOnly cookies, plus CSRF protection on every change.</li>
              <li>• Each business&apos;s documents, chats and orders are isolated.</li>
              <li>• Keys are stored as hashes and can be revoked instantly.</li>
              <li>• Login attempts and widget messages are rate-limited.</li>
            </ul>
          </motion.div>
        </aside>
      </div>

      <AnimatePresence>{revealed && <NewKeyReveal value={revealed} onClose={() => setRevealed(null)} />}</AnimatePresence>
    </div>
  );
}
