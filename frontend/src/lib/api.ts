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

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError("Can't reach the Rehber API. Is the backend running on port 8000?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new ApiError(typeof detail === "string" ? detail : `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

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
