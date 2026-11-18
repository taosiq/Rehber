"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowUp, MessageSquarePlus, MessagesSquare, Square, Sparkles } from "lucide-react";
import { useTenant } from "@/components/dashboard/TenantContext";
import { MessageBubble, type UiMessage } from "@/components/dashboard/chat/MessageBubble";
import { chatApi, isRtlText, streamChat, type ConversationSummary } from "@/lib/chat";

const suggestions = [
  { text: "Are you open on Saturday?", lang: "EN" },
  { text: "Diş beyazlatma ne kadar?", lang: "TR" },
  { text: "Gibt es einen Flughafentransfer?", lang: "DE" },
  { text: "Как можно оплатить?", lang: "RU" },
  { text: "هل الاستشارة مجانية؟", lang: "AR" },
  { text: "کیا آپ اتوار کو کھلے ہیں؟", lang: "UR" },
];

let keySeq = 0;
const nextKey = () => `m${++keySeq}`;

export default function ChatPlayground() {
  const { current } = useTenant();
  const tid = current?.id;
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(async () => {
    if (!tid) return;
    try {
      setHistory(await chatApi.conversations(tid));
    } catch {}
  }, [tid]);

  // Reset when switching business.
  useEffect(() => {
    let alive = true;
    if (tid) chatApi.conversations(tid).then((h) => alive && setHistory(h)).catch(() => {});
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [tid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Deep link: /dashboard/chat?c=<conversation id>
  const openRef = useRef<(id: string) => Promise<void>>(null);
  useEffect(() => {
    openRef.current = openConversation; // runs before the deep-link effect below
  });
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (id && tid) openRef.current?.(id).catch(() => {});
  }, [tid]);

  const patchLast = (fn: (m: UiMessage) => UiMessage) =>
    setMessages((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || !tid || streaming) return;
    setInput("");
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { key: nextKey(), role: "user", content: message },
      { key: nextKey(), role: "assistant", content: "", streaming: true },
    ]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamChat(
        tid,
        { message, conversation_id: conversationId },
        {
          onMeta: (d) => {
            setConversationId(d.conversation_id);
            setMessages((prev) => {
              const out = [...prev];
              out[out.length - 2] = { ...out[out.length - 2], language: d.language };
              out[out.length - 1] = { ...out[out.length - 1], language: d.language, retrieved: d.sources };
              return out;
            });
          },
          onToken: (t) => patchLast((m) => ({ ...m, content: m.content + t })),
          onDone: (d) =>
            patchLast((m) => ({
              ...m,
              streaming: false,
              content: m.content.trim(),
              sources: d.cited,
              stats: {
                model: d.model,
                prompt_tokens: d.prompt_tokens,
                completion_tokens: d.completion_tokens,
                latency_ms: d.latency_ms,
                first_token_ms: d.first_token_ms,
              },
            })),
          onError: (msg) => patchLast((m) => ({ ...m, streaming: false, error: msg })),
        },
        ctrl.signal,
      );
    } catch (e) {
      patchLast((m) => ({ ...m, streaming: false, error: (e as Error).message }));
    } finally {
      patchLast((m) => (m.streaming ? { ...m, streaming: false } : m));
      setStreaming(false);
      abortRef.current = null;
      loadHistory();
      inputRef.current?.focus();
    }
  };

  const openConversation = async (id: string) => {
    if (!tid || streaming) return;
    const stored = await chatApi.messages(tid, id);
    setConversationId(id);
    setMessages(
      stored.map((m) => ({
        key: m.id,
        role: m.role,
        content: m.content,
        language: m.language,
        sources: m.sources ?? [],
        stats:
          m.role === "assistant" && m.latency_ms != null
            ? {
                model: m.model ?? "",
                prompt_tokens: m.prompt_tokens ?? 0,
                completion_tokens: m.completion_tokens ?? 0,
                latency_ms: m.latency_ms,
                first_token_ms: m.first_token_ms,
              }
            : undefined,
      })),
    );
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    inputRef.current?.focus();
  };

  if (!current) return null;

  return (
    <div className="flex h-screen">
      {/* Conversation history */}
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-line bg-black/10 xl:flex">
        <div className="p-5">
          <button
            onClick={newChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-white/[0.04] py-3 text-sm font-medium transition-colors hover:bg-white/[0.08]"
          >
            <MessageSquarePlus size={16} className="text-accent" /> New conversation
          </button>
        </div>
        <p className="px-6 pb-2 text-xs uppercase tracking-wider text-muted">History</p>
        <div className="flex-1 overflow-y-auto px-3 pb-5">
          <AnimatePresence initial={false}>
            {history.map((c) => (
              <motion.button
                key={c.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => openConversation(c.id)}
                className={clsx(
                  "mb-1 w-full rounded-xl px-3 py-2.5 text-left transition-colors",
                  c.id === conversationId ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                )}
              >
                <p dir={isRtlText(c.title ?? "") ? "rtl" : "ltr"} className="truncate text-sm">{c.title ?? "Untitled"}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {c.message_count} messages · {new Date(c.created_at).toLocaleDateString()}
                </p>
              </motion.button>
            ))}
          </AnimatePresence>
          {!history.length && <p className="px-3 text-sm text-muted">No conversations yet.</p>}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-8 py-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Playground</p>
            <h1 className="font-display text-3xl">Chat as a customer of {current.name}</h1>
          </div>
          <span className="hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-muted md:inline-flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Live · answers only from your Knowledge
          </span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
            {messages.length === 0 ? (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center pt-16 text-center">
                <motion.div
                  animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.06, 1] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent to-violet shadow-[0_0_60px_-10px_rgba(245,181,68,0.6)]"
                >
                  <Sparkles className="text-black" size={28} />
                </motion.div>
                <h2 className="mt-6 font-display text-4xl">Ask anything, in any language</h2>
                <p className="mt-2 max-w-md text-muted">
                  The agent answers from {current.name}&apos;s documents, cites its sources, and says when it doesn&apos;t know.
                </p>
                <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {suggestions.map((s, i) => (
                    <motion.button
                      key={s.text}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 + i * 0.06 }}
                      whileHover={{ y: -2 }}
                      onClick={() => send(s.text)}
                      className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left transition-colors hover:border-accent/40"
                    >
                      <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">{s.lang}</span>
                      <span dir={isRtlText(s.text) ? "rtl" : "ltr"} className="flex-1 text-sm">{s.text}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ) : (
              messages.map((m) => <MessageBubble key={m.key} msg={m} />)
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-line px-6 py-5">
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="glow-border mx-auto flex max-w-4xl items-end gap-3 rounded-2xl bg-[#0d0d14]/90 p-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              dir={isRtlText(input) ? "rtl" : "ltr"}
              rows={1}
              placeholder="Type a customer question… (Enter to send, Shift+Enter for a new line)"
              className="max-h-40 min-h-[48px] flex-1 resize-none bg-transparent px-3 py-3 text-base outline-none placeholder:text-muted/60"
            />
            {streaming ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="grid h-12 w-12 place-items-center rounded-xl bg-white/10 transition-colors hover:bg-white/20" aria-label="Stop">
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <motion.button whileTap={{ scale: 0.92 }} disabled={!input.trim()} className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-black transition-opacity disabled:opacity-40" aria-label="Send">
                <ArrowUp size={20} />
              </motion.button>
            )}
          </form>
          <p className="mx-auto mt-2 flex max-w-4xl items-center gap-1.5 text-xs text-muted">
            <MessagesSquare size={12} /> Conversations are saved and will appear in Analytics later.
          </p>
        </div>
      </section>
    </div>
  );
}
