"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeft, Bot, CheckCheck, CircleCheck, Clock3, Globe2, Hand, Inbox, Loader2, MessageCircleMore, PauseCircle, PlayCircle,
  Search, Send, UserRound, X,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/WhatsAppIcon";
import { useAuth } from "@/components/auth/AuthContext";
import { useTenant } from "@/components/dashboard/TenantContext";
import { MessageBubble, type UiMessage } from "@/components/dashboard/chat/MessageBubble";
import { inboxApi } from "@/lib/api";
import type { ConversationSummary, StoredMessage } from "@/lib/chat";
import { CHANNEL_NAMES, LANG_NAMES, initials, timeAgo } from "@/lib/format";

type Filter = "all" | "handoff" | "unread" | "open" | "resolved";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "handoff", label: "Needs human" }, { key: "unread", label: "Unread" },
  { key: "open", label: "AI handling" }, { key: "resolved", label: "Resolved" },
];

const inboxChanged = () => window.dispatchEvent(new Event("rehber:inbox-changed"));

function toUi(m: StoredMessage): UiMessage {
  return {
    key: m.id, role: m.role, author: m.author_name, content: m.content, language: m.language,
    sources: m.sources ?? [], tools: m.tool_calls ?? undefined, delivery: m.delivery,
  };
}

/** WhatsApp shows the profile name; the number is in customer_contact. */
const customerLabel = (c: ConversationSummary) => c.customer_name || c.customer_contact || c.title || "Visitor";

function windowLeft(iso: string | null | undefined, now: number): { open: boolean; text: string } {
  if (!iso) return { open: false, text: "" };
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { open: false, text: "" };
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return { open: true, text: h > 0 ? `${h} h ${m} min` : `${m} min` };
}

export default function ConversationsPage() {
  const { current } = useTenant();
  const tid = current?.id;
  const [filter, setFilter] = useState<Filter>("all");
  const [channel, setChannel] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [list, setList] = useState<{ key: string; rows: ConversationSummary[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Deep links: ?c=<id> opens a conversation, ?status=handoff picks a filter.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = p.get("c"), s = p.get("status"), ch = p.get("channel");
    Promise.resolve().then(() => {
      if (c) setSelected(c);
      if (s && FILTERS.some((f) => f.key === s)) setFilter(s as Filter);
      if (ch && ["widget", "whatsapp", "playground"].includes(ch)) setChannel(ch);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const listKey = `${tid}|${filter}|${channel}|${debouncedQ}`;
  useEffect(() => {
    if (!tid) return;
    let alive = true;
    const load = () => inboxApi.list(tid, {
      status: ["handoff", "open", "resolved"].includes(filter) ? filter : undefined,
      unread: filter === "unread", channel: channel || undefined, q: debouncedQ,
    }).then((rows) => alive && setList({ key: listKey, rows }), () => {});
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [tid, filter, channel, debouncedQ, listKey, tick]);

  const select = (id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id); else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  };
  const refreshList = useCallback(() => setTick((t) => t + 1), []);

  if (!current) return null;
  const rows = list?.key === listKey ? list.rows : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] lg:h-screen">
      {/* -------- list */}
      <section className={clsx("flex w-full flex-col border-r border-line md:w-[380px] md:shrink-0", selected && "hidden md:flex")}>
        <div className="border-b border-line p-5">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-4xl">Inbox</h1>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel"
              className="rounded-lg border border-line bg-[#111118] px-2.5 py-1.5 text-sm text-muted outline-none focus:border-accent">
              <option value="">All channels</option>
              <option value="widget">Website</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="playground">Playground</option>
            </select>
          </div>
          <div className="relative mt-4">
            <Search size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages, contacts…"
              className="w-full rounded-xl border border-line bg-white/[0.03] py-2.5 pe-9 ps-10 text-sm outline-none focus:border-accent" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"><X size={15} /></button>}
          </div>
          <LayoutGroup id="inbox-filters">
            <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={clsx("relative shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors", filter === f.key ? "text-black" : "text-muted hover:text-foreground")}>
                  {filter === f.key && <motion.span layoutId="filter-pill" className="absolute inset-0 rounded-lg bg-accent" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <span className="relative">{f.label}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {!rows ? (
            <div className="grid h-40 place-items-center text-muted"><Loader2 className="animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="grid h-60 place-items-center px-6 text-center text-muted">
              <div><Inbox className="mx-auto mb-3" />{debouncedQ ? "Nothing matches your search." : filter === "all" ? "No conversations yet." : "Nothing here. Nice!"}</div>
            </div>
          ) : (
            <motion.ul layout className="flex flex-col gap-0.5">
              <AnimatePresence initial={false}>
                {rows.map((c) => <Row key={c.id} c={c} active={c.id === selected} onClick={() => select(c.id)} />)}
              </AnimatePresence>
            </motion.ul>
          )}
        </div>
      </section>

      {/* -------- thread */}
      <section className={clsx("min-w-0 flex-1", !selected && "hidden md:block")}>
        {selected ? (
          <Thread key={selected} tid={current.id} cid={selected} onBack={() => select(null)} onChanged={refreshList} />
        ) : (
          <div className="grid h-full place-items-center p-10 text-center">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-line bg-card">
                <MessageCircleMore className="text-accent" size={32} />
                <motion.span className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-violet"
                  animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              </div>
              <h2 className="mt-5 text-2xl font-medium">Pick a conversation</h2>
              <p className="mt-2 max-w-sm text-muted">Read what customers asked, take over from the AI, and reply as a person. Your reply appears live in the website chat or on the customer&apos;s WhatsApp.</p>
            </motion.div>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ c, active, onClick }: { c: ConversationSummary; active: boolean; onClick: () => void }) {
  const who = customerLabel(c);
  const isWa = c.channel === "whatsapp";
  const letters = (c.customer_name || c.customer_contact || "").replace(/[^\p{L}\s]/gu, " ").trim();
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <button onClick={onClick}
        className={clsx("relative flex w-full gap-3 rounded-2xl p-3 text-start transition-colors", active ? "bg-white/[0.07]" : "hover:bg-white/[0.035]")}>
        {active && <motion.span layoutId="row-active" className="absolute inset-y-3 start-0 w-1 rounded-full bg-accent" />}
        <span className={clsx("relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-semibold",
          isWa ? "bg-emerald-400/15 text-emerald-300" : c.channel === "widget" ? "bg-cyan/15 text-cyan" : "bg-violet/15 text-violet")}>
          {letters ? initials(letters) : isWa ? <WhatsAppIcon size={19} /> : c.channel === "widget" ? <Globe2 size={18} /> : <Bot size={18} />}
          {isWa && letters && (
            <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-400 text-black ring-2 ring-[#09090f]">
              <WhatsAppIcon size={11} />
            </span>
          )}
          {c.status === "handoff" && <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-black"><Hand size={11} /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={clsx("truncate", c.unread ? "font-semibold text-foreground" : "text-foreground/90")} dir="auto">{who}</span>
            <span className="ms-auto shrink-0 text-xs text-muted">{timeAgo(c.last_message_at)}</span>
          </span>
          <span className={clsx("mt-0.5 block truncate text-sm", c.unread ? "text-foreground/80" : "text-muted")} dir="auto">
            {c.last_message?.role === "staff" ? "Team: " : c.last_message?.role === "assistant" ? "AI: " : ""}
            {c.last_message?.preview ?? c.title}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
            {c.ai_paused ? (
              <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-emerald-300">{c.assigned_to ? c.assigned_to.name.split(" ")[0] : "Team"} handling</span>
            ) : c.status === "resolved" ? (
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-muted">Resolved</span>
            ) : (
              <span className="rounded-md bg-violet/15 px-1.5 py-0.5 text-violet">AI</span>
            )}
            {c.language && <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-muted">{LANG_NAMES[c.language] ?? c.language}</span>}
            <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-muted">{CHANNEL_NAMES[c.channel] ?? c.channel}</span>
            {c.unread && <span className="ms-auto h-2.5 w-2.5 rounded-full bg-violet shadow-[0_0_10px_rgba(139,92,246,0.9)]" />}
          </span>
        </span>
      </button>
    </motion.li>
  );
}

function Thread({ tid, cid, onBack, onChanged }: { tid: string; cid: string; onBack: () => void; onChanged: () => void }) {
  const { me } = useAuth();
  const [convo, setConvo] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<StoredMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async (markSeen: boolean) => {
    const [c, m] = await Promise.all([inboxApi.get(tid, cid), inboxApi.messages(tid, cid)]);
    setConvo(c);
    setMessages(m);
    if (markSeen && c.unread && document.visibilityState === "visible") {
      await inboxApi.seen(tid, cid).catch(() => {});
      setConvo({ ...c, unread: false });
      inboxChanged();
      onChanged();
    }
  }, [tid, cid, onChanged]);

  useEffect(() => {
    let alive = true;
    const first = setTimeout(() => load(true).catch((e: Error) => alive && setError(e.message)), 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(true).catch(() => {}), 4000);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
  }, [load]);

  // Scroll to the bottom when new messages arrive (instantly on first load).
  useEffect(() => {
    if (!messages || !scroller.current) return;
    const el = scroller.current;
    const first = lastCount.current === 0;
    if (messages.length !== lastCount.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: first ? "instant" : "smooth" });
      lastCount.current = messages.length;
    }
  }, [messages]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await load(false);
      inboxChanged();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const optimistic: StoredMessage = {
      id: `tmp-${Date.now()}`, role: "staff", author_name: me.name, created_at: new Date().toISOString(), content: body,
      language: null, sources: null, tool_calls: null, model: null, prompt_tokens: null, completion_tokens: null,
      latency_ms: null, first_token_ms: null,
    };
    setMessages((m) => [...(m ?? []), optimistic]);
    setText("");
    try {
      await inboxApi.reply(tid, cid, body);
      await load(false);
      inboxChanged();
      onChanged();
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== optimistic.id));
      setText(body);
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const ui = useMemo(() => (messages ?? []).map(toUi), [messages]);
  // Re-render every 30 s so the WhatsApp reply-window countdown stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!convo || !messages) {
    return <div className="grid h-full place-items-center text-muted">{error ?? <Loader2 className="animate-spin" />}</div>;
  }
  const isWidget = convo.channel === "widget";
  const isWa = convo.channel === "whatsapp";
  const win = windowLeft(convo.reply_window_ends_at, now);
  const locked = isWa && !win.open;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/5 md:hidden" aria-label="Back"><ArrowLeft size={18} /></button>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 truncate text-lg font-medium" dir="auto">
              {isWa && <WhatsAppIcon size={18} className="shrink-0 text-emerald-300" />}
              <span className="truncate">{customerLabel(convo)}</span>
            </h2>
            <p className="truncate text-sm text-muted">
              {isWa && convo.customer_name && convo.customer_contact ? <span className="font-mono">{convo.customer_contact} · </span> : null}
              {CHANNEL_NAMES[convo.channel] ?? convo.channel}{convo.language ? ` · ${LANG_NAMES[convo.language] ?? convo.language}` : ""} · started {timeAgo(convo.created_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {convo.ai_paused ? (
              <ActionButton icon={PlayCircle} label="Hand back to AI" busy={busy === "release"} onClick={() => act("release", () => inboxApi.release(tid, cid))} />
            ) : (
              <ActionButton icon={PauseCircle} label="Take over" busy={busy === "takeover"} onClick={() => act("takeover", () => inboxApi.takeover(tid, cid))} primary />
            )}
            {convo.status !== "resolved" && (
              <ActionButton icon={CircleCheck} label="Resolve" busy={busy === "resolve"} onClick={() => act("resolve", () => inboxApi.resolve(tid, cid))} />
            )}
          </div>
        </div>

        {/* messages */}
        <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {convo.handoff_reason && convo.status === "handoff" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/[0.07] p-4 text-sm">
                <Hand size={18} className="mt-0.5 shrink-0 text-accent" />
                <span><b className="font-medium">Needs a human.</b> <span className="text-muted">{convo.handoff_reason}</span></span>
              </motion.div>
            )}
            {ui.map((m) => <MessageBubble key={m.key} msg={m} />)}
            {convo.status === "resolved" && (
              <p className="flex items-center justify-center gap-2 text-sm text-emerald-300"><CheckCheck size={16} /> Resolved. If the customer writes again, the AI answers.</p>
            )}
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-line p-4">
          <div className="mx-auto max-w-3xl">
            <AnimatePresence mode="wait">
              <motion.p key={String(convo.ai_paused)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={clsx("mb-2 flex items-center gap-2 text-xs", convo.ai_paused ? "text-emerald-300" : "text-muted")}>
                {convo.ai_paused ? <><UserRound size={13} /> {convo.assigned_to?.name ?? "Your team"} is handling this. The AI is paused.</>
                  : <><Bot size={13} /> The AI is answering. Sending a reply takes over the conversation.</>}
                {!isWidget && !isWa && <span className="text-muted">· Playground chat: replies show only here.</span>}
                {isWa && win.open && <span className="ms-auto inline-flex items-center gap-1.5 text-emerald-300/80"><WhatsAppIcon size={13} /> Sent to their WhatsApp · {win.text} left to reply</span>}
              </motion.p>
            </AnimatePresence>
            {error && <p className="mb-2 text-sm text-red-300">{error}</p>}
            <AnimatePresence>
              {locked && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <p className="mb-2 flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-3.5 py-2.5 text-sm text-amber-100">
                    <Clock3 size={16} className="mt-0.5 shrink-0 text-amber-300" />
                    WhatsApp only lets businesses reply within 24 hours of the customer&apos;s last message. When they write again, you can answer here.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
            <div className={clsx("flex items-end gap-2 rounded-2xl border border-line bg-white/[0.03] p-2 transition-colors focus-within:border-emerald-400/50", locked && "opacity-50")}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} dir="auto" disabled={locked}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                placeholder={locked ? "Reply window closed" : `Reply as ${me.name.split(" ")[0]}…`}
                className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-base outline-none [field-sizing:content]" />
              <motion.button whileTap={{ scale: 0.92 }} onClick={send} disabled={!text.trim() || sending || locked} aria-label="Send reply"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-400 text-black transition-opacity disabled:opacity-30">
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* details */}
      <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-line p-6 2xl:block">
        <h3 className="text-sm uppercase tracking-wider text-muted">Details</h3>
        <dl className="mt-4 flex flex-col gap-4 text-sm">
          {[
            ...(convo.customer_name ? [["Name", convo.customer_name]] : []),
            [isWa ? "WhatsApp number" : "Customer", convo.customer_contact ?? "Not shared"],
            ["Channel", CHANNEL_NAMES[convo.channel] ?? convo.channel],
            ["Language", convo.language ? LANG_NAMES[convo.language] ?? convo.language : "—"],
            ["Status", convo.status === "handoff" ? "Needs human" : convo.status === "resolved" ? "Resolved" : "AI handling"],
            ["Handled by", convo.ai_paused ? convo.assigned_to?.name ?? "Team" : "AI agent"],
            ["Messages", String(convo.message_count)],
            ["Started", new Date(convo.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
          ].map(([k, v]) => (
            <div key={k}><dt className="text-muted">{k}</dt><dd className="mt-0.5 break-words" dir="auto">{v}</dd></div>
          ))}
        </dl>
      </aside>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, busy, primary }: {
  icon: typeof Hand; label: string; onClick: () => void; busy?: boolean; primary?: boolean;
}) {
  return (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onClick} disabled={busy}
      className={clsx("inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60",
        primary ? "bg-accent text-black hover:brightness-110" : "border border-line hover:bg-white/5")}>
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
      <span className="hidden sm:inline">{label}</span>
    </motion.button>
  );
}
