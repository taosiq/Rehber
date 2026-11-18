/** Typed client for the Rehber FastAPI backend. */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  default_language: string;
  created_at: string;
};

export type DocStatus = "pending" | "processing" | "ready" | "failed";

export type DocumentItem = {
  id: string;
  title: string;
  source_type: "pdf" | "url" | "text";
  source_uri: string | null;
  status: DocStatus;
  error: string | null;
  chunk_count: number;
  char_count: number;
  created_at: string;
};

export type SearchHit = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  source_type: string;
  source_uri: string | null;
  page: number | null;
  content: string;
  score: number;
};

export type SearchResponse = { query: string; hits: SearchHit[]; took_ms: number };

export class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

// ---------- session plumbing ----------
// The session lives in an HttpOnly cookie (JavaScript can't read it). The CSRF token is
// kept only in memory and sent on every state-changing request.
let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const session = {
  setCsrf: (t: string | null) => { csrfToken = t; },
  onUnauthorized: (fn: (() => void) | null) => { onUnauthorized = fn; },
};

/** fetch() with cookies + CSRF header. Used by every API call. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the Rehber API. Is the backend running on port 8000?");
  }
  if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    const first = Array.isArray(detail) ? detail[0]?.msg?.replace(/^Value error, /, "") : null;
    throw new ApiError(typeof detail === "string" ? detail : first ?? `Request failed (${res.status})`, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ---------- auth ----------

export type Me = {
  id: string;
  email: string;
  name: string;
  csrf_token: string;
  tenants: { id: string; name: string; role: "owner" | "admin" | "member" }[];
};

export const authApi = {
  me: () => request<Me>("/auth/me"),
  login: (email: string, password: string) => request<Me>("/auth/login", json({ email, password })),
  signup: (name: string, email: string, password: string) => request<Me>("/auth/signup", json({ name, email, password })),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  forgot: (email: string) => request<{ detail: string }>("/auth/forgot", json({ email })),
  reset: (token: string, new_password: string) => request<void>("/auth/reset", json({ token, new_password })),
};

// ---------- API keys ----------

export type ApiKeyItem = {
  id: string;
  name: string;
  kind: "publishable" | "secret";
  prefix: string;
  allowed_origins: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export const keysApi = {
  list: (tid: string) => request<ApiKeyItem[]>(`/tenants/${tid}/api-keys`),
  create: (tid: string, body: { name: string; kind: ApiKeyItem["kind"]; allowed_origins: string[] }) =>
    request<ApiKeyItem & { key: string }>(`/tenants/${tid}/api-keys`, json(body)),
  revoke: (tid: string, id: string) => request<void>(`/tenants/${tid}/api-keys/${id}`, { method: "DELETE" }),
};

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  listTenants: () => request<Tenant[]>("/tenants"),
  createTenant: (name: string) => request<Tenant>("/tenants", json({ name })),

  listDocuments: (tid: string) => request<DocumentItem[]>(`/tenants/${tid}/documents`),
  uploadPdf: (tid: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<DocumentItem>(`/tenants/${tid}/documents/upload`, { method: "POST", body: form });
  },
  addUrl: (tid: string, url: string) => request<DocumentItem>(`/tenants/${tid}/documents/url`, json({ url })),
  addText: (tid: string, title: string, text: string) =>
    request<DocumentItem>(`/tenants/${tid}/documents/text`, json({ title, text })),
  reprocess: (tid: string, id: string) =>
    request<DocumentItem>(`/tenants/${tid}/documents/${id}/reprocess`, { method: "POST" }),
  deleteDocument: (tid: string, id: string) =>
    request<void>(`/tenants/${tid}/documents/${id}`, { method: "DELETE" }),

  search: (tid: string, query: string, k = 5) => request<SearchResponse>(`/tenants/${tid}/search`, json({ query, k })),
};

// ---------- Agent tools: settings, appointments, orders, hand-offs ----------

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type BusinessSettings = {
  timezone: string;
  tools: { booking: boolean; orders: boolean; handoff: boolean };
  booking: {
    slot_minutes: number;
    hours: Record<Weekday, string | null>;
    services: { name: string; minutes: number }[];
    max_days_ahead: number;
  };
  widget: WidgetSettings;
};

export type WidgetSettings = {
  title: string | null;
  color: string;
  position: "right" | "left";
  greetings: Partial<Record<string, string>>;
  suggestions: boolean;
};

export type Appointment = {
  id: string;
  code: string;
  customer_name: string;
  customer_contact: string;
  service: string;
  start_at: string;
  end_at: string;
  status: "confirmed" | "cancelled";
  notes: string | null;
  conversation_id: string | null;
};

export type Order = {
  id: string;
  order_number: string;
  customer_email: string | null;
  customer_phone: string | null;
  status: string;
  items: { name: string; qty: number }[];
  total: string;
  currency: string;
  carrier: string | null;
  tracking_number: string | null;
  estimated_delivery: string | null;
};

export type Handoff = {
  id: string;
  title: string | null;
  status: string;
  handoff_reason: string | null;
  handoff_at: string | null;
  customer_contact: string | null;
  message_count: number;
  created_at: string;
};

const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const toolsApi = {
  getSettings: (tid: string) => request<BusinessSettings>(`/tenants/${tid}/settings`),
  saveSettings: (tid: string, s: BusinessSettings) => request<BusinessSettings>(`/tenants/${tid}/settings`, put(s)),
  appointments: (tid: string) => request<Appointment[]>(`/tenants/${tid}/appointments`),
  cancelAppointment: (tid: string, id: string) =>
    request<Appointment>(`/tenants/${tid}/appointments/${id}/cancel`, { method: "POST" }),
  orders: (tid: string) => request<Order[]>(`/tenants/${tid}/orders`),
  loadDemoOrders: (tid: string) => request<void>(`/tenants/${tid}/orders/demo`, { method: "POST" }),
  handoffs: (tid: string) => request<Handoff[]>(`/tenants/${tid}/conversations?status=handoff`),
  resolve: (tid: string, cid: string) =>
    request<void>(`/tenants/${tid}/conversations/${cid}/resolve`, { method: "POST" }),
};

// ---------- analytics ----------

export type Totals = {
  conversations: number;
  questions: number;
  answers: number;
  errors: number;
  error_rate: number;
  cited_rate: number;
  handoffs: number;
  bookings: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  cost_per_answer_usd: number;
  latency_ms: { avg: number | null; p50: number | null; p95: number | null };
  first_token_ms: { p50: number | null; p95: number | null };
};

export type DailyPoint = {
  date: string;
  answers: number;
  conversations: number;
  errors: number;
  cost_usd: number;
  tokens: number;
  latency_p50: number | null;
  latency_p95: number | null;
  first_token_p50: number | null;
};

export type Analytics = {
  range: { days: number; from: string; to: string; timezone: string };
  totals: Totals;
  previous: Totals;
  daily: DailyPoint[];
  languages: { language: string; count: number }[];
  channels: { channel: string; conversations: number }[];
  tools: { name: string; calls: number; errors: number }[];
  models: { model: string; answers: number; cost_usd: number; priced: boolean }[];
  error_kinds: { kind: string; count: number }[];
  slowest: { message_id: string; conversation_id: string; latency_ms: number; first_token_ms: number | null;
    created_at: string; question: string; trace_url: string | null }[];
  tracing: { enabled: boolean; base_url: string | null };
};

export type Overview = { days: number; businesses: (Totals & { tenant_id: string; name: string; role: "owner" | "admin" | "member" })[] };

export type EvalReport = {
  model: string;
  started_at: string;
  judge: boolean;
  summary: {
    cases: number; passed: number; pass_rate: number;
    by_tag: Record<string, { passed: number; total: number }>;
    by_language: Record<string, { passed: number; total: number }>;
    latency_ms: { p50: number | null; p95: number | null };
    first_token_ms: { p50: number | null; p95: number | null };
    tokens: number; cost_usd: number;
  };
  cases: { id: string; language: string; tags: string[]; passed: boolean; latency_ms: number | null; failed: string[] }[];
} | null;

export const analyticsApi = {
  tenant: (tid: string, days: number) => request<Analytics>(`/tenants/${tid}/analytics?days=${days}`),
  overview: (days: number) => request<Overview>(`/analytics/overview?days=${days}`),
  latestEval: () => request<EvalReport>("/evals/latest"),
};

// ---------- inbox, team, account, business (Phase 8) ----------

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export type Role = "owner" | "admin" | "member";
export type InboxCounts = { needs_human: number; unread: number };

export const inboxApi = {
  list: (tid: string, f: { status?: string; channel?: string; q?: string; unread?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (f.status) qs.set("status", f.status);
    if (f.channel) qs.set("channel", f.channel);
    if (f.q?.trim()) qs.set("q", f.q.trim());
    if (f.unread) qs.set("unread", "true");
    return request<import("./chat").ConversationSummary[]>(`/tenants/${tid}/conversations?${qs}`);
  },
  get: (tid: string, cid: string) => request<import("./chat").ConversationSummary>(`/tenants/${tid}/conversations/${cid}`),
  messages: (tid: string, cid: string) => request<import("./chat").StoredMessage[]>(`/tenants/${tid}/conversations/${cid}/messages`),
  counts: (tid: string) => request<InboxCounts>(`/tenants/${tid}/inbox/counts`),
  seen: (tid: string, cid: string) => request<void>(`/tenants/${tid}/conversations/${cid}/seen`, send("POST")),
  takeover: (tid: string, cid: string) => request<import("./chat").ConversationSummary>(`/tenants/${tid}/conversations/${cid}/takeover`, send("POST")),
  release: (tid: string, cid: string) => request<import("./chat").ConversationSummary>(`/tenants/${tid}/conversations/${cid}/release`, send("POST")),
  resolve: (tid: string, cid: string) => request<void>(`/tenants/${tid}/conversations/${cid}/resolve`, send("POST")),
  reply: (tid: string, cid: string, text: string) =>
    request<import("./chat").StoredMessage>(`/tenants/${tid}/conversations/${cid}/reply`, send("POST", { text })),
};

export type Member = { user_id: string; name: string; email: string; role: Role; joined_at: string; is_you: boolean };
export type Invitation = { id: string; email: string; role: Role; invited_by: string | null; created_at: string; expires_at: string };
export type InvitationPreview = { business: string; role: Role; email: string; invited_by: string | null; expires_at: string };

export const teamApi = {
  members: (tid: string) => request<Member[]>(`/tenants/${tid}/members`),
  setRole: (tid: string, uid: string, role: Role) => request<Member>(`/tenants/${tid}/members/${uid}`, send("PATCH", { role })),
  remove: (tid: string, uid: string) => request<void>(`/tenants/${tid}/members/${uid}`, send("DELETE")),
  invitations: (tid: string) => request<Invitation[]>(`/tenants/${tid}/invitations`),
  invite: (tid: string, email: string, role: Role) =>
    request<{ id: string; email: string; role: Role; expires_at: string; token: string; emailed: boolean }>(`/tenants/${tid}/invitations`, send("POST", { email, role })),
  revoke: (tid: string, id: string) => request<void>(`/tenants/${tid}/invitations/${id}`, send("DELETE")),
  preview: (token: string) => request<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
  accept: (token: string) => request<{ tenant_id: string }>(`/invitations/${encodeURIComponent(token)}/accept`, send("POST")),
};

export type SessionInfo = { id: string; created_at: string; last_seen_at: string | null; ip: string | null; user_agent: string | null; current: boolean };

export const accountApi = {
  updateName: (name: string) => request<Me>("/auth/me", send("PATCH", { name })),
  changePassword: (current_password: string, new_password: string) =>
    request<void>("/auth/password", send("POST", { current_password, new_password })),
  sessions: () => request<SessionInfo[]>("/auth/sessions"),
  revokeOthers: () => request<void>("/auth/sessions/revoke-others", send("POST")),
};

export const businessApi = {
  update: (tid: string, body: { name?: string; default_language?: string }) => request<Tenant>(`/tenants/${tid}`, send("PATCH", body)),
  remove: (tid: string, confirm_name: string) => request<void>(`/tenants/${tid}/delete`, send("POST", { confirm_name })),
};

export type OverviewData = {
  business: { name: string; timezone: string; default_language: string };
  setup: { documents: boolean; documents_ready: number; documents_total: number; tools: boolean; tested: boolean;
    widget_key: boolean; widget_live: boolean; team: boolean; tracing: boolean };
  today: { conversations: number; answers: number; bookings: number; needs_human: number };
  recent: import("./chat").ConversationSummary[];
  upcoming: { id: string; code: string; customer_name: string; service: string; start_at: string; conversation_id: string | null }[];
};

export const overviewApi = { get: (tid: string) => request<OverviewData>(`/tenants/${tid}/overview`) };
