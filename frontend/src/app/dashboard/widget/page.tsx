"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Check, Code2, Copy, ExternalLink, Globe, KeyRound, Languages, Loader2, Lock, MousePointerClick, Palette,
  PanelLeft, PanelRight, Save, Sparkles,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import { useTenant } from "@/components/dashboard/TenantContext";
import { API_URL, keysApi, toolsApi, type ApiKeyItem, type BusinessSettings, type WidgetSettings } from "@/lib/api";
import { streamChat } from "@/lib/chat";

// ------------------------------------------------------------ the widget script (public/widget.js)

type Handlers = Record<"meta" | "token" | "tool" | "done" | "error", (d: Record<string, unknown>) => void>;
type WidgetConfig = { business_name: string; default_language?: string; widget: Partial<WidgetSettings>; tools: Partial<BusinessSettings["tools"]> };
type MountHandle = { update(c: WidgetConfig): void; setLanguage(code: string): void; destroy(): void };
declare global {
  interface Window {
    Rehber?: {
      mount(el: HTMLElement, o: { config: WidgetConfig; backend: { chat(b: Record<string, unknown>, h: Handlers, s?: AbortSignal): Promise<void> }; open?: boolean }): MountHandle;
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadWidgetScript() {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (window.Rehber) return resolve();
    const s = document.createElement("script");
    s.src = "/widget.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error("Could not load widget.js")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

const LANGS = [
  { code: "tr", name: "Türkçe" }, { code: "en", name: "English" }, { code: "de", name: "Deutsch" },
  { code: "ru", name: "Русский" }, { code: "fr", name: "Français" }, { code: "ar", name: "العربية" },
  { code: "fa", name: "فارسی" }, { code: "ur", name: "اردو" },
];
const RTL = new Set(["ar", "fa", "ur"]);
// Same built-in greetings as public/widget.js (shown when a language has no custom greeting).
const DEFAULT_GREETING: Record<string, string> = {
  en: "Hi there! 👋 How can we help you today?",
  tr: "Merhaba! 👋 Size nasıl yardımcı olabiliriz?",
  de: "Hallo! 👋 Wie können wir Ihnen helfen?",
  ru: "Здравствуйте! 👋 Чем мы можем помочь?",
  fr: "Bonjour ! 👋 Comment pouvons-nous vous aider ?",
  ar: "مرحباً! 👋 كيف يمكننا مساعدتك اليوم؟",
  fa: "سلام! 👋 چطور می‌توانیم کمکتان کنیم؟",
  ur: "السلام علیکم! 👋 ہم آپ کی کیا مدد کر سکتے ہیں؟",
};
const PRESETS = ["#f5b544", "#8b5cf6", "#06b6d4", "#10b981", "#f43f5e", "#3b82f6", "#f97316", "#1f2937"];

/** In the preview, the widget talks to the dashboard chat API (your login) instead of a public key. */
function previewBackend(tid: string) {
  return {
    chat: (body: Record<string, unknown>, h: Handlers, signal?: AbortSignal) =>
      streamChat(tid, { message: String(body.message), conversation_id: (body.conversation_id as string) ?? null }, {
        onMeta: (d) => h.meta({ conversation_id: d.conversation_id, language: d.language }),
        onToken: (text) => h.token({ text }),
        onTool: (c) => h.tool({ id: c.id, name: c.name, status: c.status }),
        onDone: (d) => h.done({
          message_id: d.message_id, conversation_status: d.conversation_status,
          cited: d.cited.map((s) => ({ n: s.n, title: s.document_title, page: s.page, url: s.source_type === "url" ? s.source_uri : null })),
        }),
        onError: (message) => h.error({ message }),
      }, signal),
  };
}

// ------------------------------------------------------------ small UI pieces

function Card({ title, icon: Icon, children, i = 0, action }: {
  title: string; icon: typeof Palette; children: React.ReactNode; i?: number; action?: React.ReactNode;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.07 }}
      className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-medium"><Icon size={18} className="text-accent" />{title}</h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

const inputCls = "w-full rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-base outline-none transition-colors focus:border-accent";

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button disabled={disabled}
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20 disabled:opacity-40">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(done)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}
          className="inline-flex items-center gap-1.5">
          {done ? <><Check size={14} className="text-emerald-300" /> Copied</> : <><Copy size={14} /> Copy</>}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

// ------------------------------------------------------------ live preview

function Preview({ tid, config, lang }: { tid: string; config: WidgetConfig; lang: string }) {
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<MountHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadWidgetScript().then(() => alive && setReady(true), () => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  // Mount once per business; settings changes are applied live by the effects below.
  useEffect(() => {
    if (!ready || !box.current || !window.Rehber) return;
    const h = window.Rehber.mount(box.current, { config: { business_name: "", widget: {}, tools: {} }, backend: previewBackend(tid) });
    handle.current = h;
    return () => { h.destroy(); handle.current = null; };
  }, [ready, tid]);
  useEffect(() => { handle.current?.update(config); }, [config, ready, tid]);
  useEffect(() => { handle.current?.setLanguage(lang); }, [lang, ready, tid]);

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-[#0d0d14] shadow-2xl">
      {/* browser chrome */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="flex gap-1.5">{["bg-red-400/70", "bg-amber-300/70", "bg-emerald-400/70"].map((c) => <span key={c} className={clsx("h-3 w-3 rounded-full", c)} />)}</div>
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-white/[0.05] px-3 py-1.5 font-mono text-xs text-muted">
          <Lock size={11} /> www.your-business.com
        </div>
      </div>
      {/* a pretend website */}
      <div className="relative h-[700px] overflow-hidden bg-[#f6f5f2]">
        <div className="pointer-events-none select-none p-8 opacity-90">
          <div className="flex items-center justify-between">
            <div className="h-6 w-28 rounded-md bg-[#1f2937]/80" />
            <div className="flex gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-3 w-14 rounded bg-[#1f2937]/20" />)}</div>
          </div>
          <div className="mt-16 max-w-md">
            <div className="h-9 w-4/5 rounded-lg bg-[#1f2937]/75" />
            <div className="mt-3 h-9 w-3/5 rounded-lg bg-[#1f2937]/75" />
            <div className="mt-6 h-3 w-full rounded bg-[#1f2937]/15" />
            <div className="mt-2 h-3 w-11/12 rounded bg-[#1f2937]/15" />
            <div className="mt-2 h-3 w-2/3 rounded bg-[#1f2937]/15" />
            <div className="mt-7 h-11 w-36 rounded-xl" style={{ background: config.widget.color }} />
          </div>
          <div className="mt-14 grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="h-20 rounded-xl bg-[#1f2937]/[0.07]" />
                <div className="mt-3 h-3 w-3/4 rounded bg-[#1f2937]/20" />
                <div className="mt-2 h-3 w-1/2 rounded bg-[#1f2937]/10" />
              </div>
            ))}
          </div>
        </div>
        <div ref={box} />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-sm text-black/50">
            {failed ? "Could not load the widget preview." : <Loader2 className="animate-spin" />}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ page

export default function WidgetPage() {
  const { me } = useAuth();
  const { current } = useTenant();
  const tid = current?.id;
  const role = me.tenants.find((t) => t.id === tid)?.role ?? "member";
  const canManage = role === "owner" || role === "admin";

  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [lang, setLang] = useState("en");

  useEffect(() => {
    let alive = true;
    if (tid) toolsApi.getSettings(tid).then((s) => {
      if (!alive) return;
      setSettings(s);
      setSavedJson(JSON.stringify(s.widget));
    }).catch((e: Error) => alive && setToast({ ok: false, text: e.message }));
    return () => { alive = false; };
  }, [tid]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const widget = settings?.widget;
  const dirty = !!widget && JSON.stringify(widget) !== savedJson;
  const set = (patch: Partial<WidgetSettings>) => setSettings((s) => (s ? { ...s, widget: { ...s.widget, ...patch } } : s));

  const previewConfig = useMemo<WidgetConfig | null>(
    () => (settings && current ? { business_name: current.name, default_language: "en", widget: settings.widget, tools: settings.tools } : null),
    [settings, current],
  );

  const save = async () => {
    if (!tid || !settings) return;
    setSaving(true);
    try {
      const saved = await toolsApi.saveSettings(tid, settings);
      setSettings(saved);
      setSavedJson(JSON.stringify(saved.widget));
      setToast({ ok: true, text: "Saved. Visitors see the new look on their next page load." });
    } catch (e) {
      setToast({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!current) return null;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">Website widget</p>
          <h1 className="mt-2 font-display text-5xl md:text-6xl">Your agent, <span className="italic text-gradient">on your site</span></h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">Style the chat bubble, preview it live in all 8 languages, then add one line to your website.</p>
        </div>
        <div className="flex items-center gap-4">
          <AnimatePresence>
            {dirty && (
              <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                className="flex items-center gap-2 text-sm text-amber-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" /> Unsaved changes
              </motion.span>
            )}
          </AnimatePresence>
          <motion.button whileTap={{ scale: 0.96 }} onClick={save} disabled={saving || !canManage || !dirty}
            title={canManage ? undefined : "Only owners and admins can change the widget"}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-base font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)] disabled:opacity-50">
            {saving ? <Loader2 size={18} className="animate-spin" /> : canManage ? <Save size={18} /> : <Lock size={18} />} Save widget
          </motion.button>
        </div>
      </motion.header>

      {!settings || !widget || !previewConfig ? (
        <div className="mt-16 grid place-items-center text-muted"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* ---------------- settings column */}
          <div className="flex flex-col gap-8">
            <Card title="Appearance" icon={Palette}>
              <label className="block text-sm text-muted">Title in the chat header</label>
              <input value={widget.title ?? ""} maxLength={60} placeholder={current.name}
                onChange={(e) => set({ title: e.target.value || null })} className={clsx(inputCls, "mt-2")} />

              <p className="mt-6 text-sm text-muted">Brand color</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {PRESETS.map((c) => (
                  <button key={c} onClick={() => set({ color: c })} aria-label={`Color ${c}`}
                    className="relative grid h-11 w-11 place-items-center rounded-full transition-transform hover:scale-110" style={{ background: c }}>
                    {widget.color === c && (
                      <motion.span layoutId="color-ring" className="absolute -inset-1.5 rounded-full border-2 border-white/80"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                    )}
                  </button>
                ))}
                <label className="relative flex h-11 items-center gap-2 rounded-full border border-line bg-white/[0.04] pe-4 ps-1.5 text-sm text-muted hover:bg-white/[0.08]">
                  <span className="h-8 w-8 rounded-full border border-white/20" style={{ background: widget.color }} />
                  <span className="font-mono">{widget.color}</span>
                  <input type="color" value={widget.color} onChange={(e) => set({ color: e.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom color" />
                </label>
              </div>

              <p className="mt-6 text-sm text-muted">Position</p>
              <div className="mt-3 inline-flex rounded-2xl border border-line bg-white/[0.03] p-1">
                {([["left", PanelLeft, "Bottom left"], ["right", PanelRight, "Bottom right"]] as const).map(([pos, Icon, label]) => (
                  <button key={pos} onClick={() => set({ position: pos })}
                    className={clsx("relative flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm transition-colors", widget.position === pos ? "text-black" : "text-muted hover:text-foreground")}>
                    {widget.position === pos && (
                      <motion.span layoutId="pos-pill" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
                    )}
                    <span className="relative flex items-center gap-2"><Icon size={16} /> {label}</span>
                  </button>
                ))}
              </div>

              <label className="mt-6 flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-white/[0.02] p-4">
                <span>
                  <span className="flex items-center gap-2 font-medium"><MousePointerClick size={16} className="text-accent" /> Quick-reply suggestions</span>
                  <span className="mt-1 block text-sm text-muted">Buttons like “Book an appointment”, based on the tools you turned on.</span>
                </span>
                <input type="checkbox" checked={widget.suggestions} onChange={(e) => set({ suggestions: e.target.checked })}
                  className="h-5 w-5 accent-[#f5b544]" />
              </label>
            </Card>

            <Card title="Greeting" icon={Languages} i={1}>
              <p className="text-sm text-muted">
                The widget opens in the visitor&apos;s browser language and switches when they write in another one. Leave a greeting empty to use the built-in one.
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {LANGS.map((l) => (
                  <button key={l.code} onClick={() => setLang(l.code)}
                    className={clsx("relative rounded-xl px-3.5 py-2 text-sm transition-colors", lang === l.code ? "text-black" : "text-muted hover:bg-white/5 hover:text-foreground")}>
                    {lang === l.code && <motion.span layoutId="lang-pill" className="absolute inset-0 rounded-xl bg-accent" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                    <span className="relative">
                      {l.name}
                      {widget.greetings[l.code] && <span className="ms-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />}
                    </span>
                  </button>
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={lang} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                  <textarea dir={RTL.has(lang) ? "rtl" : "ltr"} lang={lang} rows={3} maxLength={300}
                    value={widget.greetings[lang] ?? ""} placeholder={DEFAULT_GREETING[lang]}
                    onChange={(e) => set({ greetings: { ...widget.greetings, [lang]: e.target.value } })}
                    className={clsx(inputCls, "mt-4 resize-none")} />
                  <p className="mt-1.5 text-end text-xs text-muted">{(widget.greetings[lang] ?? "").length}/300</p>
                </motion.div>
              </AnimatePresence>
            </Card>

            <InstallCard tid={current.id} canManage={canManage} />
          </div>

          {/* ---------------- preview column */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="xl:sticky xl:top-8">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm text-muted"><Sparkles size={15} className="text-accent" /> Live preview: real answers from your agent</p>
              <span className="font-mono text-xs text-muted">{lang.toUpperCase()}{RTL.has(lang) ? " · RTL" : ""}</span>
            </div>
            <Preview tid={current.id} config={previewConfig} lang={lang} />
            <p className="mt-3 text-sm text-muted">Preview chats are saved as Playground conversations, so they don&apos;t mix with your real website visitors.</p>
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={clsx("fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border px-5 py-3 text-sm shadow-2xl backdrop-blur-xl",
              toast.ok ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-100" : "border-red-400/30 bg-red-400/15 text-red-100")}>
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------ install

function InstallCard({ tid, canManage }: { tid: string; canManage: boolean }) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [site, setSite] = useState("");
  const [allowLocal, setAllowLocal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ key: string; origins: string[] } | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let alive = true;
    // window is only available in the browser; read it after mount.
    Promise.resolve(window.location.origin).then((o) => alive && setOrigin(o));
    if (canManage) keysApi.list(tid).then((k) => alive && setKeys(k)).catch(() => {});
    return () => { alive = false; };
  }, [tid, canManage]);

  const widgetKeys = keys.filter((k) => k.kind === "publishable" && !k.revoked_at);
  const keyValue = created?.key ?? "pk_PASTE_YOUR_WIDGET_KEY";
  // The snippet runs on other websites, so it needs the full API address even when the dashboard uses "/api".
  const apiBase = API_URL.startsWith("http") ? API_URL : `${origin}${API_URL}`;
  const snippet = `<script src="${origin}/widget.js"
        data-key="${keyValue}"
        data-api="${apiBase}" defer></script>`;
  const canTest = !!created && created.origins.includes(origin.toLowerCase());

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const origins: string[] = [];
    const v = site.trim().replace(/\/+$/, "");
    if (v) {
      if (!/^https?:\/\/[^/\s]+$/i.test(v)) return setError("Enter your website like https://www.yourshop.com (no path).");
      origins.push(v.toLowerCase());
    }
    if (allowLocal && origin) origins.push(origin.toLowerCase());
    if (!origins.length) return setError("Add your website address.");
    setBusy(true);
    try {
      const k = await keysApi.create(tid, { name: "Website widget", kind: "publishable", allowed_origins: Array.from(new Set(origins)) });
      setCreated({ key: k.key, origins: k.allowed_origins });
      setKeys((ks) => [k, ...ks]);
      setSite("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const step = (n: number, title: string) => (
    <h3 className="flex items-center gap-3 font-medium">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-sm text-accent">{n}</span>{title}
    </h3>
  );

  return (
    <Card title="Add it to your website" icon={Code2} i={2}>
      <div className="flex flex-col gap-7">
        <div>
          {step(1, "Create a widget key")}
          {!canManage ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Lock size={14} /> Ask an owner or admin to create a widget key.</p>
          ) : created ? (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              <p className="flex items-center gap-2 font-medium"><Check size={16} /> Key created and put into the code below.</p>
              <p className="mt-1 text-emerald-100/80">Works only on: {created.origins.join(", ")}. Copy the code now: the full key is shown only once.</p>
            </motion.div>
          ) : (
            <form onSubmit={create} className="mt-3 flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe size={16} className="absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://www.your-business.com"
                    className={clsx(inputCls, "ps-11")} />
                </div>
                <motion.button whileTap={{ scale: 0.96 }} disabled={busy}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium hover:bg-white/15 disabled:opacity-50">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Create key
                </motion.button>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={allowLocal} onChange={(e) => setAllowLocal(e.target.checked)} className="accent-[#f5b544]" />
                Also allow <code className="font-mono text-xs">{origin}</code> so you can test on the sample page
              </label>
              {error && <p className="text-sm text-red-300">{error}</p>}
              {widgetKeys.length > 0 && (
                <p className="text-sm text-muted">
                  You already have {widgetKeys.length} widget key{widgetKeys.length > 1 ? "s" : ""} ({widgetKeys.map((k) => `${k.prefix}…`).join(", ")}).
                  You can paste one into the code instead. Manage keys in <Link href="/dashboard/settings" className="text-accent hover:underline">Settings</Link>.
                </p>
              )}
            </form>
          )}
        </div>

        <div>
          {step(2, "Paste this before </body> on every page")}
          <div className="relative mt-3 overflow-hidden rounded-2xl border border-line bg-black/50">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="font-mono text-xs text-muted">HTML</span>
              <CopyButton text={snippet} disabled={!origin} />
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-foreground/90"><code>
              <span className="text-violet-300">&lt;script</span> <span className="text-cyan-300">src</span>=<span className="text-amber-200">&quot;{origin}/widget.js&quot;</span>{"\n        "}
              <span className="text-cyan-300">data-key</span>=<span className={clsx(created ? "text-emerald-300" : "text-amber-200/60")}>&quot;{keyValue}&quot;</span>{"\n        "}
              <span className="text-cyan-300">data-api</span>=<span className="text-amber-200">&quot;{apiBase}&quot;</span> <span className="text-cyan-300">defer</span><span className="text-violet-300">&gt;&lt;/script&gt;</span>
            </code></pre>
          </div>
          <p className="mt-2 text-sm text-muted">Works with any website: WordPress, Shopify, Wix, or plain HTML. Optional: <code className="font-mono text-xs">data-lang=&quot;tr&quot;</code> forces a language.</p>
        </div>

        <div>
          {step(3, "Try it")}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href={canTest ? `/widget-test.html#key=${encodeURIComponent(created!.key)}&api=${encodeURIComponent(apiBase)}` : undefined}
              target="_blank" rel="noopener noreferrer" aria-disabled={!canTest}
              className={clsx("inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors",
                canTest ? "bg-accent text-black hover:brightness-110" : "pointer-events-none bg-white/5 text-muted")}>
              <ExternalLink size={16} /> Open the sample website
            </a>
            {!canTest && <span className="text-sm text-muted">Create a key above (with the testing option on) to try the real widget.</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}
