/** Streaming chat client: POSTs a message and parses the Server-Sent Events reply. */

import { ApiError, apiFetch } from "./api";

export type ChatSource = {
  n: number;
  chunk_id: string;
  document_id: string;
  document_title: string;
  source_type: string;
  source_uri: string | null;
  page: number | null;
  content: string;
  score: number;
};

export type ChatStats = {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  first_token_ms: number | null;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result: Record<string, unknown> | null;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  channel: string;
  status: "open" | "handoff" | "resolved";
  ai_paused: boolean;
  assigned_to: { id: string; name: string } | null;
  handoff_reason: string | null;
  handoff_at: string | null;
  customer_contact: string | null;
  customer_name?: string | null; // WhatsApp profile name
  language: string | null;
  message_count: number;
  reply_window_ends_at?: string | null; // WhatsApp: free-form replies allowed until then
  unread: boolean;
  last_message: { role: "user" | "assistant" | "staff"; preview: string; at: string } | null;
  last_message_at: string | null;
  created_at: string;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "staff";
  author_name: string | null;
  created_at: string;
  content: string;
  language: string | null;
  sources: ChatSource[] | null;
  tool_calls: ToolCall[] | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  first_token_ms: number | null;
  delivery?: Delivery | null;
};

export type Delivery = "sent" | "delivered" | "read" | "failed";

type Handlers = {
  onMeta?: (d: { conversation_id: string; language: string | null; sources: ChatSource[] }) => void;
  onToken?: (text: string) => void;
  onTool?: (call: ToolCall) => void;
  onDone?: (
    d: ChatStats & {
      message_id: string;
      conversation_id: string;
      conversation_status: ConversationSummary["status"];
      cited: ChatSource[];
      tool_calls: ToolCall[];
    },
  ) => void;
  onError?: (message: string) => void;
};

export async function streamChat(
  tenantId: string,
  body: { message: string; conversation_id?: string | null },
  handlers: Handlers,
  signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await apiFetch(`/tenants/${tenantId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw e;
  }
  if (!res.ok || !res.body) {
    const detail = (await res.json().catch(() => null))?.detail;
    throw new ApiError(typeof detail === "string" ? detail : `Chat failed (${res.status})`, res.status);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (event === "meta") handlers.onMeta?.(parsed);
        else if (event === "token") handlers.onToken?.(parsed.text);
        else if (event === "tool") handlers.onTool?.(parsed);
        else if (event === "done") handlers.onDone?.(parsed);
        else if (event === "error") handlers.onError?.(parsed.message);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`);
  return res.json();
}

export const chatApi = {
  conversations: (tid: string) => get<ConversationSummary[]>(`/tenants/${tid}/conversations`),
  messages: (tid: string, cid: string) => get<StoredMessage[]>(`/tenants/${tid}/conversations/${cid}/messages`),
};

export const RTL_LANGS = new Set(["ar", "fa", "ur"]);
export const isRtlText = (s: string) => /[֐-ࣿ]/.test(s.slice(0, 60));
