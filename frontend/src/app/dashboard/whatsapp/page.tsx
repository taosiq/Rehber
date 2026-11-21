"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  AlertTriangle, ArrowRight, Check, CheckCheck, Copy, ExternalLink, Eye, EyeOff, Inbox, KeyRound, Link2, Loader2, Lock,
  MessagesSquare, Plug, RefreshCw, Send, ServerCog, ShieldCheck, Unplug, Webhook,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import { useTenant } from "@/components/dashboard/TenantContext";
import { WhatsAppIcon } from "@/components/icons/WhatsAppIcon";
import { whatsappApi, type WhatsAppStatus } from "@/lib/api";
import { timeAgo } from "@/lib/format";

const WA_GREEN = "#25d366";
const inputCls = "w-full rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-base outline-none transition-colors focus:border-emerald-400/70";

// ------------------------------------------------------------ small UI pieces

function Card({ title, icon: Icon, children, i = 0, action, className }: {
  title: string; icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode; i?: number;
  action?: React.ReactNode; className?: string;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.07 }}
      className={clsx("rounded-3xl border border-line bg-card p-6 backdrop-blur-xl", className)}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-medium"><Icon size={18} className="text-emerald-300" />{title}</h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm text-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-black/40 py-1.5 pe-1.5 ps-4">
        <span className={clsx("min-w-0 flex-1 truncate text-sm", mono && "font-mono")}>{value}</span>
        <button onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800); }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={String(done)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}
              className="inline-flex items-center gap-1.5">
              {done ? <><Check size={14} className="text-emerald-300" /> Copied</> : <><Copy size={14} /> Copy</>}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative min-w-0 ps-12">
      <span className={clsx("absolute start-0 top-0 grid h-8 w-8 place-items-center rounded-full text-sm font-semibold transition-colors",
        done ? "bg-emerald-400 text-black" : "bg-emerald-400/15 text-emerald-300")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={String(done)} initial={{ scale: 0.4, rotate: -30 }} animate={{ scale: 1, rotate: 0 }}>
            {done ? <Check size={16} /> : n}
          </motion.span>
        </AnimatePresence>
      </span>
      <h3 className="pt-1 font-medium">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const Toast = ({ toast }: { toast: { ok: boolean; text: string } | null }) => (
  <AnimatePresence>
    {toast && (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
        className={clsx("fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl border px-5 py-3 text-sm shadow-2xl backdrop-blur-xl",
          toast.ok ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100" : "border-red-400/30 bg-red-400/15 text-red-100")}>
        {toast.text}
      </motion.div>
    )}
  </AnimatePresence>
);

// ------------------------------------------------------------ animated phone

type Bubble = { from: "them" | "us"; text: string };
const SCRIPT: Bubble[] = [
  { from: "them", text: "Merhaba! Cumartesi açık mısınız? 🙂" },
  { from: "us", text: "Merhaba! Evet, cumartesi 09:00–14:00 arası açığız. Randevu ister misiniz?" },
  { from: "them", text: "Yes please, 10:00 for a cleaning" },
  { from: "us", text: "Done! ✅ Teeth cleaning, Saturday 10:00. Your code is *RB-7K2Q*. See you then!" },
];

/** A WhatsApp chat that plays itself: customer writes, "typing…", the AI answers, ticks turn blue. */
function PhonePreview({ name, number }: { name: string; number: string | null }) {
  const [step, setStep] = useState(0); // number of bubbles shown; odd -> AI typing before next
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (step >= SCRIPT.length) {
      t = setTimeout(() => setStep(0), 4500);
    } else if (SCRIPT[step].from === "us" && !typing) {
      t = setTimeout(() => setTyping(true), 700);
    } else if (typing) {
      t = setTimeout(() => { setTyping(false); setStep((s) => s + 1); }, 1600);
    } else {
      t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 900 : 1800);
    }
    return () => clearTimeout(t);
  }, [step, typing]);

  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <motion.div aria-hidden className="absolute -inset-10 -z-10 rounded-full blur-3xl"
        style={{ background: `radial-gradient(closest-side, ${WA_GREEN}33, transparent)` }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 6, repeat: Infinity }} />
      <div className="overflow-hidden rounded-[2.6rem] border-[10px] border-[#1b1b22] bg-[#0b141a] shadow-[0_40px_120px_-30px_rgba(37,211,102,0.35)]">
        {/* status bar + chat header */}
        <div className="bg-[#1f2c34] px-4 pb-3 pt-2">
          <div className="flex justify-between px-1 font-mono text-[10px] text-white/60"><span>9:41</span><span>5G ▮▮▮</span></div>
          <div className="mt-2 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full font-semibold text-black" style={{ background: WA_GREEN }}>
              {name.trim()[0]?.toUpperCase() ?? "R"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-white">{name}</p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={String(typing)} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }}
                  className={clsx("truncate text-xs", typing ? "text-emerald-300" : "text-white/50")}>
                  {typing ? "typing…" : number ?? "Business account"}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        </div>
        {/* messages */}
        <div className="flex h-[430px] flex-col justify-end gap-2 px-3 py-4"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
          <AnimatePresence initial={false}>
            {SCRIPT.slice(0, step).map((b, i) => (
              <motion.div key={`${i}-${b.text}`} layout initial={{ opacity: 0, y: 14, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className={clsx("max-w-[82%] rounded-xl px-3 py-2 text-[13.5px] leading-snug text-white shadow",
                  b.from === "us" ? "self-start rounded-tl-sm bg-[#202c33]" : "self-end rounded-tr-sm bg-[#005c4b]")}>
                {b.text.split(/(\*[^*]+\*)/g).map((p, j) => p.startsWith("*") && p.endsWith("*")
                  ? <b key={j} className="font-semibold">{p.slice(1, -1)}</b> : <span key={j}>{p}</span>)}
                <span className="ms-2 inline-flex translate-y-0.5 items-center gap-0.5 align-bottom text-[10px] text-white/45">
                  {`10:0${i}`}
                  {b.from === "them" && <CheckCheck size={13} className={i < step - 1 || typing ? "text-sky-400" : "text-white/45"} />}
                </span>
              </motion.div>
            ))}
            {typing && (
              <motion.div key="typing" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                className="flex gap-1 self-start rounded-xl rounded-tl-sm bg-[#202c33] px-3.5 py-3">
                {[0, 1, 2].map((d) => (
                  <motion.span key={d} className="h-1.5 w-1.5 rounded-full bg-white/60"
                    animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* composer */}
        <div className="flex items-center gap-2 bg-[#1f2c34] px-3 py-2.5">
          <div className="flex-1 rounded-full bg-[#2a3942] px-4 py-2 text-xs text-white/40">Message</div>
          <span className="grid h-9 w-9 place-items-center rounded-full text-black" style={{ background: WA_GREEN }}><Send size={15} /></span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ page

export default function WhatsAppPage() {
  const { me } = useAuth();
  const { current } = useTenant();
  const tid = current?.id;
  const role = me.tenants.find((t) => t.id === tid)?.role ?? "member";
  const canManage = role === "owner" || role === "admin";

  const [status, setStatus] = useState<{ tid: string; s: WhatsAppStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (id: string) => {
    try {
      const s = await whatsappApi.get(id);
      setStatus({ tid: id, s });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!tid) return;
    const first = setTimeout(() => load(tid), 0);
    // While the page is open, pick up "last message received" and delivery problems.
    const timer = setInterval(() => document.visibilityState === "visible" && load(tid), 15000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [tid, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!current) return null;
  const s = status && status.tid === tid ? status.s : null;
  const acct = s?.account ?? null;

  return (
    <div className="mx-auto w-full max-w-[1500px] overflow-x-clip px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em] text-emerald-300"><WhatsAppIcon size={15} /> WhatsApp</p>
          <h1 className="mt-2 font-display text-5xl md:text-6xl">Your agent, <span className="italic text-gradient">on WhatsApp</span></h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">
            Customers message your WhatsApp number and get instant answers in their language: same knowledge, bookings and hand-offs as your website.
          </p>
        </div>
        {s && (
          <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className={clsx("inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm",
              s.connected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-line bg-white/[0.03] text-muted")}>
            <span className="relative flex h-2.5 w-2.5">
              {s.connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
              <span className={clsx("relative inline-flex h-2.5 w-2.5 rounded-full", s.connected ? "bg-emerald-400" : "bg-white/30")} />
            </span>
            {s.connected ? "Live on WhatsApp" : "Not connected"}
          </motion.span>
        )}
      </motion.header>

      {!s ? (
        <div className="mt-16 grid place-items-center text-muted">{error ?? <Loader2 className="animate-spin" />}</div>
      ) : (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] items-start gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="flex flex-col gap-8">
            {!s.webhook.server_ready && <ServerNotice />}
            {acct && !editing ? (
              <ConnectedCard tid={current.id} s={s} canManage={canManage} onEdit={() => setEditing(true)}
                onChanged={() => load(current.id)} setToast={setToast} />
            ) : canManage ? (
              <SetupCard tid={current.id} s={s} replacing={!!acct} onCancel={acct ? () => setEditing(false) : undefined}
                onConnected={(next) => { setStatus({ tid: current.id, s: next }); setEditing(false);
                  setToast({ ok: true, text: "Connected! Send a WhatsApp message to your number to try it." }); }} />
            ) : (
              <Card title="Not connected yet" icon={Lock}>
                <p className="text-muted">Ask an owner or admin of {current.name} to connect your WhatsApp number on this page.</p>
              </Card>
            )}
            <HowItWorks i={3} />
          </div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="xl:sticky xl:top-8">
            <PhonePreview name={acct?.verified_name || current.name} number={acct?.display_phone_number ?? null} />
            <p className="mt-6 text-center text-sm text-muted">A preview of what your customers see. The real answers come from your knowledge and tools.</p>
          </motion.div>
        </div>
      )}
      <Toast toast={toast} />
    </div>
  );
}

// ------------------------------------------------------------ cards

function ServerNotice() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-3xl border border-amber-300/30 bg-amber-300/[0.07] p-5">
      <ServerCog className="mt-0.5 shrink-0 text-amber-300" size={20} />
      <div>
        <p className="font-medium text-amber-100">The server isn&apos;t set up for WhatsApp yet</p>
        <p className="mt-1 text-sm text-amber-100/75">
          Whoever runs this Rehber server adds <code className="font-mono text-xs">WHATSAPP_APP_SECRET</code> and{" "}
          <code className="font-mono text-xs">WHATSAPP_VERIFY_TOKEN</code> to <code className="font-mono text-xs">backend/.env</code>.
          Until then, messages from Meta are refused.
        </p>
      </div>
    </motion.div>
  );
}

function SetupCard({ tid, s, replacing, onConnected, onCancel }: {
  tid: string; s: WhatsAppStatus; replacing: boolean; onConnected: (s: WhatsAppStatus) => void; onCancel?: () => void;
}) {
  const [pnid, setPnid] = useState(s.account?.phone_number_id ?? "");
  const [waba, setWaba] = useState(s.account?.waba_id ?? "");
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{5,32}$/.test(pnid.trim())) return setError("The Phone number ID is a long number, e.g. 106540352242922.");
    if (waba.trim() && !/^\d{5,32}$/.test(waba.trim())) return setError("The WhatsApp Business Account ID is digits only.");
    if (token.trim().length < 20) return setError("Paste the access token from Meta.");
    setBusy(true);
    try {
      onConnected(await whatsappApi.connect(tid, { phone_number_id: pnid.trim(), access_token: token.trim(), waba_id: waba.trim() || null }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={replacing ? "Update the connection" : "Connect your WhatsApp number"} icon={Plug}
      action={onCancel && <button onClick={onCancel} className="text-sm text-muted hover:text-foreground">Cancel</button>}>
      <div className="flex flex-col gap-8">
        <Step n={1} title="Point Meta's webhook to Rehber" done={replacing}>
          <p className="text-sm text-muted">
            In your app on <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:underline">developers.facebook.com <ExternalLink size={12} className="inline" /></a>:
            {" "}WhatsApp → <b className="font-medium text-foreground/90">Configuration</b> → Webhook → Edit. Paste these two, click <b className="font-medium text-foreground/90">Verify and save</b>,
            then under Webhook fields turn on <code className="font-mono text-xs">messages</code>.
          </p>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3">
            <CopyField label="Callback URL" value={s.webhook.url} />
            {s.webhook.verify_token ? <CopyField label="Verify token" value={s.webhook.verify_token} />
              : <p className="text-sm text-amber-200">No verify token is set on the server yet.</p>}
          </div>
          {!s.webhook.public && (
            <p className="mt-3 flex items-start gap-2 text-sm text-amber-200"><AlertTriangle size={15} className="mt-0.5 shrink-0" />
              This address isn&apos;t a public https:// address, so Meta can&apos;t reach it. Use your public Rehber address.</p>
          )}
        </Step>

        <Step n={2} title="Paste your number's details">
          <p className="text-sm text-muted">Find them under WhatsApp → <b className="font-medium text-foreground/90">API Setup</b>. Rehber checks them with Meta before saving.</p>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm text-muted">Phone number ID</span>
                <input value={pnid} onChange={(e) => setPnid(e.target.value)} inputMode="numeric" placeholder="e.g. 106540352242922"
                  className={clsx(inputCls, "font-mono")} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-muted">WhatsApp Business Account ID <span className="text-xs">(optional)</span></span>
                <input value={waba} onChange={(e) => setWaba(e.target.value)} inputMode="numeric" placeholder="e.g. 102290129340398"
                  className={clsx(inputCls, "font-mono")} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-sm text-muted"><KeyRound size={14} /> Access token</span>
              <div className="relative">
                <input type={show ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off"
                  spellCheck={false} placeholder="EAAG…" className={clsx(inputCls, "pe-12 font-mono")} />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide token" : "Show token"}
                  className="absolute end-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground">
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <span className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
                <ShieldCheck size={13} className="mt-px shrink-0 text-emerald-300" />
                Stored encrypted and never shown again. Meta&apos;s temporary token expires after 24 hours; for a lasting connection use a System User token.
              </span>
            </label>
            <AnimatePresence>
              {error && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
                </motion.p>
              )}
            </AnimatePresence>
            <motion.button whileTap={{ scale: 0.97 }} disabled={busy}
              className="inline-flex items-center justify-center gap-2 self-start rounded-xl px-6 py-3 font-semibold text-black shadow-[0_0_40px_-8px_rgba(37,211,102,0.7)] transition-[filter] hover:brightness-110 disabled:opacity-60"
              style={{ background: WA_GREEN }}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />} {busy ? "Checking with Meta…" : replacing ? "Save" : "Connect"}
            </motion.button>
          </form>
        </Step>

        <Step n={3} title="Say hello">
          <p className="text-sm text-muted">Send a WhatsApp message to your business number from your phone. The answer arrives in seconds, and the chat appears in your Inbox.</p>
        </Step>
      </div>
    </Card>
  );
}

function Stat({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="rounded-2xl border border-line bg-white/[0.02] p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
    </motion.div>
  );
}

function ConnectedCard({ tid, s, canManage, onEdit, onChanged, setToast }: {
  tid: string; s: WhatsAppStatus; canManage: boolean; onEdit: () => void; onChanged: () => void;
  setToast: (t: { ok: boolean; text: string }) => void;
}) {
  const a = s.account!;
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const test = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim()) return;
    setSending(true);
    try {
      await whatsappApi.test(tid, to);
      setToast({ ok: true, text: "Test message sent. Check that phone's WhatsApp." });
    } catch (err) {
      setToast({ ok: false, text: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  const disconnect = async () => {
    setRemoving(true);
    try {
      await whatsappApi.disconnect(tid);
      onChanged();
      setToast({ ok: true, text: "Disconnected. Past WhatsApp chats stay in your Inbox." });
    } catch (err) {
      setToast({ ok: false, text: (err as Error).message });
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <Card title="Connected" icon={WhatsAppIcon}
        action={canManage && (
          <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-foreground">
            <RefreshCw size={14} /> Update token
          </button>
        )}>
        <div className="flex flex-wrap items-center gap-5">
          <motion.span initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className="grid h-16 w-16 place-items-center rounded-2xl text-black shadow-[0_0_50px_-10px_rgba(37,211,102,0.8)]" style={{ background: WA_GREEN }}>
            <WhatsAppIcon size={32} />
          </motion.span>
          <div className="min-w-0">
            <p className="text-2xl font-medium">{a.display_phone_number ?? "Your number"}</p>
            <p className="text-muted">{a.verified_name ?? "WhatsApp Business"} · connected {timeAgo(a.connected_at)}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="WhatsApp chats" value={String(s.stats.conversations)} delay={0.1} />
          <Stat label="Messages, last 7 days" value={String(s.stats.messages_7d)} delay={0.16} />
          <Stat label="Last message in" value={a.last_inbound_at ? timeAgo(a.last_inbound_at) : "None yet"} delay={0.22} />
        </div>

        <AnimatePresence>
          {(a.last_error || !a.token_ok) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/[0.07] p-4 text-sm">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
                <div>
                  <p className="text-amber-100">{!a.token_ok ? "The saved token can't be read any more. Update the token." : a.last_error}</p>
                  {a.last_error_at && <p className="mt-1 text-amber-100/60">{timeAgo(a.last_error_at)}{/expired|OAuth|token/i.test(a.last_error ?? "") ? " · Tokens from API Setup expire after 24 hours: update the token." : ""}</p>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!a.last_inbound_at && (
          <p className="mt-5 flex items-start gap-2 rounded-2xl border border-line bg-white/[0.02] p-4 text-sm text-muted">
            <Webhook size={16} className="mt-0.5 shrink-0 text-emerald-300" />
            No messages have arrived yet. If you send one and nothing happens, check the webhook in Meta (Callback URL below, field <code className="font-mono text-xs">messages</code> turned on).
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/dashboard/conversations?channel=whatsapp"
            className="group inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-black transition-[filter] hover:brightness-110" style={{ background: WA_GREEN }}>
            <Inbox size={16} /> Open WhatsApp chats <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </Card>

      {canManage && (
        <Card title="Test and settings" icon={MessagesSquare} i={1}>
          <form onSubmit={test}>
            <p className="text-sm text-muted">
              Send Meta&apos;s &quot;hello world&quot; message to a phone. With the free test number, the phone must be added under &quot;To&quot; in API Setup first.
            </p>
            <div className="mt-3 flex gap-2">
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+90 532 123 45 67" inputMode="tel" className={clsx(inputCls, "font-mono")} />
              <motion.button whileTap={{ scale: 0.96 }} disabled={sending || !to.trim()}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium hover:bg-white/15 disabled:opacity-50">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send test
              </motion.button>
            </div>
          </form>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3">
            <CopyField label="Webhook callback URL (in Meta)" value={s.webhook.url} />
            {s.webhook.verify_token && <CopyField label="Verify token" value={s.webhook.verify_token} />}
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <AnimatePresence mode="wait" initial={false}>
              {confirming ? (
                <motion.div key="confirm" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-red-200">Disconnect {a.display_phone_number}? The AI stops answering on WhatsApp.</span>
                  <button onClick={disconnect} disabled={removing}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60">
                    {removing ? <Loader2 size={15} className="animate-spin" /> : <Unplug size={15} />} Yes, disconnect
                  </button>
                  <button onClick={() => setConfirming(false)} className="text-sm text-muted hover:text-foreground">Cancel</button>
                </motion.div>
              ) : (
                <motion.button key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-red-300">
                  <Unplug size={15} /> Disconnect this number
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </Card>
      )}
    </>
  );
}

function HowItWorks({ i }: { i: number }) {
  const items = [
    { icon: CheckCheck, title: "Read and typing", text: "Customers see blue ticks and “typing…” while the AI writes." },
    { icon: MessagesSquare, title: "Their language", text: "Answers in any of the 8 languages, formatted for WhatsApp." },
    { icon: Inbox, title: "Team take-over", text: "Reply from the Inbox and it goes to their WhatsApp; the AI pauses." },
    { icon: ShieldCheck, title: "Verified and private", text: "Every message from Meta is signature-checked; tokens are encrypted." },
  ];
  return (
    <Card title="How it works" icon={WhatsAppIcon} i={i}>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it, k) => (
          <motion.div key={it.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + k * 0.06 }}
            whileHover={{ y: -3 }} className="rounded-2xl border border-line bg-white/[0.02] p-4">
            <it.icon size={18} className="text-emerald-300" />
            <p className="mt-2 font-medium">{it.title}</p>
            <p className="mt-1 text-sm text-muted">{it.text}</p>
          </motion.div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">
        WhatsApp rule: you can reply freely for 24 hours after a customer&apos;s last message. The Inbox shows how much time is left.
      </p>
    </Card>
  );
}
