"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  AlertTriangle, Building2, Check, Eye, EyeOff, KeyRound, Laptop, Loader2, Lock, LogOut, Monitor, Save, Smartphone,
  Trash2, UserRound,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import { useTenant } from "@/components/dashboard/TenantContext";
import { ApiKeysSection } from "@/components/settings/ApiKeysSection";
import { accountApi, businessApi, type SessionInfo } from "@/lib/api";
import { LANG_NAMES, timeAgo } from "@/lib/format";

type Tab = "business" | "account" | "keys";
const TABS: { key: Tab; label: string; icon: typeof Building2 }[] = [
  { key: "business", label: "Business", icon: Building2 },
  { key: "account", label: "Your account", icon: UserRound },
  { key: "keys", label: "API keys", icon: KeyRound },
];
const inputCls = "w-full rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-base outline-none placeholder:text-muted/50 focus:border-accent";

function Card({ title, icon: Icon, children, danger, i = 0 }: { title: string; icon: typeof Building2; children: React.ReactNode; danger?: boolean; i?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 + i * 0.06 }}
      className={clsx("rounded-3xl border p-6 backdrop-blur-xl", danger ? "border-red-400/25 bg-red-400/[0.03]" : "border-line bg-card")}>
      <h2 className="mb-5 flex items-center gap-2 text-xl font-medium"><Icon size={18} className={danger ? "text-red-300" : "text-accent"} />{title}</h2>
      {children}
    </motion.section>
  );
}

function Status({ state }: { state: { ok: boolean; text: string } | null }) {
  return (
    <AnimatePresence>
      {state && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          className={clsx("flex items-center gap-2 text-sm", state.ok ? "text-emerald-300" : "text-red-300")}>
          {state.ok ? <Check size={15} /> : <AlertTriangle size={15} />}{state.text}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export default function SettingsPage() {
  const { current } = useTenant();
  const [tab, setTab] = useState<Tab>("business");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.key === t)) Promise.resolve().then(() => setTab(t as Tab));
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">Settings</p>
        <h1 className="mt-2 font-display text-5xl md:text-6xl">Settings &amp; <span className="italic text-gradient">security</span></h1>
      </motion.header>

      <div className="mt-8 inline-flex flex-wrap rounded-2xl border border-line bg-white/[0.03] p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => choose(t.key)}
            className={clsx("relative flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm transition-colors", tab === t.key ? "text-black" : "text-muted hover:text-foreground")}>
            {tab === t.key && <motion.span layoutId="settings-tab" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <t.icon size={16} className="relative" /><span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="mt-8">
          {tab === "business" ? <BusinessTab key={current?.id} /> : tab === "account" ? <AccountTab /> : <ApiKeysSection />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------ business

function BusinessTab() {
  const { current, role, reload } = useTenant();
  const router = useRouter();
  const canEdit = role === "owner" || role === "admin";
  const [name, setName] = useState(current?.name ?? "");
  const [lang, setLang] = useState(current?.default_language ?? "en");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  if (!current) return null;
  const dirty = name.trim() !== current.name || lang !== current.default_language;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setState(null);
    try {
      await businessApi.update(current.id, { name: name.trim(), default_language: lang });
      await reload(current.id);
      setState({ ok: true, text: "Saved." });
    } catch (err) {
      setState({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDelError(null);
    try {
      await businessApi.remove(current.id, confirm);
      await reload();
      router.replace("/dashboard");
    } catch (err) {
      setDelError((err as Error).message);
      setDeleting(false);
    }
  };

  return (
    <div className="grid items-start gap-8 xl:grid-cols-[1.2fr_1fr]">
      <Card title="Business details" icon={Building2}>
        <form onSubmit={save} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm text-muted">Business name
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} minLength={2} maxLength={200} required className={inputCls} />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">Default language
            <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={!canEdit} className={clsx(inputCls, "bg-[#111118]")}>
              {Object.entries(LANG_NAMES).map(([code, n]) => <option key={code} value={code}>{n}</option>)}
            </select>
            <span className="text-xs">Used when the customer&apos;s language can&apos;t be detected (for example a message like &quot;ok&quot;).</span>
          </label>
          <div className="flex items-center gap-4">
            <motion.button whileTap={{ scale: 0.97 }} disabled={!canEdit || !dirty || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-semibold text-black disabled:opacity-40">
              {saving ? <Loader2 size={16} className="animate-spin" /> : canEdit ? <Save size={16} /> : <Lock size={16} />} Save
            </motion.button>
            <Status state={state} />
          </div>
          {!canEdit && <p className="text-sm text-muted">Only owners and admins can change business details.</p>}
        </form>
      </Card>

      <Card title="Delete this business" icon={Trash2} danger i={1}>
        {role !== "owner" ? (
          <p className="text-sm text-muted">Only an owner can delete the business.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              This permanently deletes <b className="text-foreground">{current.name}</b>: documents, conversations, bookings, orders, API keys and team access. The website widget stops working. This can&apos;t be undone.
            </p>
            <label className="flex flex-col gap-2 text-sm text-muted">Type the business name to confirm
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={current.name} className={clsx(inputCls, "focus:border-red-400")} />
            </label>
            {delError && <p className="text-sm text-red-300">{delError}</p>}
            <motion.button whileTap={{ scale: 0.97 }} onClick={remove} disabled={confirm !== current.name || deleting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500 py-3 font-semibold text-white transition-opacity disabled:opacity-30">
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete forever
            </motion.button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ account

function deviceOf(ua: string | null): { icon: typeof Laptop; label: string } {
  const u = ua ?? "";
  const browser = /Edg\//.test(u) ? "Edge" : /Chrome\//.test(u) ? "Chrome" : /Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : "Browser";
  const os = /Windows/.test(u) ? "Windows" : /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iOS" : /Mac OS/.test(u) ? "macOS" : /Linux/.test(u) ? "Linux" : "";
  const mobile = /Android|iPhone|iPad|Mobile/.test(u);
  return { icon: mobile ? Smartphone : os ? Laptop : Monitor, label: `${browser}${os ? ` on ${os}` : ""}` };
}

function AccountTab() {
  const { me, refresh } = useAuth();
  const [name, setName] = useState(me.name);
  const [nameState, setNameState] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [show, setShow] = useState(false);
  const [pwState, setPwState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  const loadSessions = () => accountApi.sessions().then(setSessions, () => {});
  useEffect(() => {
    const t = setTimeout(loadSessions, 0);
    return () => clearTimeout(t);
  }, []);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("name");
    try {
      await accountApi.updateName(name.trim());
      await refresh();
      setNameState({ ok: true, text: "Saved." });
    } catch (err) {
      setNameState({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("pw");
    setPwState(null);
    try {
      await accountApi.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "" });
      setPwState({ ok: true, text: "Password changed. Other devices were signed out." });
      await loadSessions();
    } catch (err) {
      setPwState({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="grid items-start gap-8 xl:grid-cols-2">
      <div className="flex flex-col gap-8">
        <Card title="Profile" icon={UserRound}>
          <form onSubmit={saveName} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-muted">Your name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} className={inputCls} />
              <span className="text-xs">Customers see only your first name when you reply in the website chat.</span>
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">Email
              <input value={me.email} disabled className={clsx(inputCls, "opacity-60")} />
            </label>
            <div className="flex items-center gap-4">
              <motion.button whileTap={{ scale: 0.97 }} disabled={busy === "name" || name.trim() === me.name || !name.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-semibold text-black disabled:opacity-40">
                {busy === "name" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </motion.button>
              <Status state={nameState} />
            </div>
          </form>
        </Card>

        <Card title="Change password" icon={Lock} i={1}>
          <form onSubmit={savePassword} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-muted">Current password
              <input type={show ? "text" : "password"} autoComplete="current-password" required value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">New password
              <span className="relative">
                <input type={show ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={128} value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })} className={clsx(inputCls, "pe-12")} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide passwords" : "Show passwords"}
                  className="absolute end-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </span>
              <span className="text-xs">At least 10 characters with some variety.</span>
            </label>
            <div className="flex flex-wrap items-center gap-4">
              <motion.button whileTap={{ scale: 0.97 }} disabled={busy === "pw" || !pw.current || pw.next.length < 10}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-semibold text-black disabled:opacity-40">
                {busy === "pw" ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Change password
              </motion.button>
              <Status state={pwState} />
            </div>
          </form>
        </Card>
      </div>

      <Card title="Where you're logged in" icon={Laptop} i={2}>
        {!sessions ? <Loader2 className="animate-spin text-muted" /> : (
          <>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {sessions.map((s) => {
                  const d = deviceOf(s.user_agent);
                  return (
                    <motion.li key={s.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 20 }}
                      className={clsx("flex items-center gap-3 rounded-2xl border p-3", s.current ? "border-emerald-400/30 bg-emerald-400/[0.05]" : "border-line bg-white/[0.02]")}>
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/5"><d.icon size={18} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">{d.label}
                          {s.current && <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">This device</span>}</span>
                        <span className="block text-xs text-muted">{s.ip ?? "unknown network"} · active {timeAgo(s.last_seen_at ?? s.created_at)}</span>
                      </span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            <motion.button whileTap={{ scale: 0.97 }} disabled={others === 0 || busy === "revoke"}
              onClick={async () => { setBusy("revoke"); await accountApi.revokeOthers().catch(() => {}); await loadSessions(); setBusy(null); }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm hover:bg-white/5 disabled:opacity-40">
              {busy === "revoke" ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
              Sign out {others ? `${others} other device${others > 1 ? "s" : ""}` : "other devices"}
            </motion.button>
            <p className="mt-3 text-xs text-muted">If you don&apos;t recognise a device, sign it out and change your password.</p>
          </>
        )}
      </Card>
    </div>
  );
}
