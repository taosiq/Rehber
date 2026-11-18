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
