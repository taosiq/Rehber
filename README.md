# Rehber

AI support agent platform. A business uploads its documents (PDFs, website pages), and its customers chat with an AI agent that:

- answers from those documents (RAG) and cites its sources
- uses tools: books appointments, checks orders, hands over to a human
- answers in 8 languages: Turkish, English, German, Russian, French, Arabic, Persian, Urdu
- runs as a website chat widget, and later on WhatsApp

**Stack:** Python, FastAPI, LangGraph, PostgreSQL + pgvector, Redis, local multilingual embeddings (EmbeddingGemma via fastembed/ONNX), Groq-hosted gpt-oss-120b for chat (free tier; provider is swappable), Next.js dashboard, Docker, GitHub Actions.

## How retrieval works

```
PDF / URL / text ─▶ extract (pypdf, trafilatura) ─▶ chunk (~1000 chars, 150 overlap,
paragraph/sentence aware) ─▶ embed (EmbeddingGemma-300m, 768-d, runs locally on CPU)
─▶ pgvector (HNSW cosine index), every row tagged with tenant_id
                                          ▲
customer question (any language) ─▶ embed ┘ ─▶ top-k passages + document/page citations
```

## How answering works

```
question ─▶ detect language (lingua, 8 languages) ─▶ retrieve top passages (tenant-scoped)
        ─▶ prompt: numbered sources + strict grounding rules + "reply only in <language>"
        ─▶ stream tokens to the client over Server-Sent Events
        ─▶ keep only sources the model actually cited ([1], [2]...) ─▶ save message with
           sources, language, prompt/completion tokens, time-to-first-token and total latency
```

- **Grounded:** if the documents don't contain the answer, the agent says so and offers a human. It doesn't invent prices or policies.

## Agent tools (LangGraph)

```
START ─▶ agent (LLM + tools) ──tool calls?──▶ tools ─▶ agent ─▶ … ─▶ END
```

| Tool | What it does | Safeguards |
|---|---|---|
| `search_knowledge` | Extra retrieval mid-answer | Tenant-scoped; results get new citation numbers |
| `check_availability` | Free slots for a date/service | Opening hours, service length, existing bookings, 30-min lead time, timezone-aware |
| `book_appointment` | Books an appointment | **Two-step confirmation enforced in code**: the first call only stores a proposal, and the booking happens only on the same details in the customer's *next* message. Idempotent, and a partial unique index blocks double-booking |
| `get_order_status` | Order status/tracking | Requires order number **and** matching email/phone; same reply for "not found" and "wrong contact" (no info leak) |
| `handoff_to_human` | Flags the conversation for staff | Shows up in the dashboard "Needs a human" list |

- Tools are built **per request and bound to one tenant and conversation** on the server. The model only supplies arguments a customer could know, never which business to act on.
- Each business can turn tools on or off and set opening hours and services. The model gets a 14-day calendar, because LLMs are unreliable at date arithmetic.
- Tested with a scripted fake chat model (47 tests); verified live with Groq in Turkish, English and Arabic.
- **Measured from day one:** every answer stores its token usage and speed, which feeds per-business cost and latency tracking (Phase 7).

- **Multilingual:** a question in Turkish, Arabic or Urdu finds English documents (and the other way around). It was checked on 8 languages; see `backend/tests`.
- **Tenant isolation:** every search and document query filters on `tenant_id`, and there are tests proving one business can't see another's data.
- **Safe URL ingestion:** private and localhost addresses are blocked (SSRF protection). The crawler identifies itself honestly, and sites that refuse it get a clear error.

## Website widget

One line on any website (WordPress, Shopify, Wix, plain HTML):

```html
<script src="https://YOUR-REHBER/widget.js" data-key="pk_..." data-api="https://YOUR-API/api" defer></script>
```

- **No dependencies, one file** (`frontend/public/widget.js`), rendered in a Shadow DOM, so the widget and the host page can't break each other's styles.
- **8 languages with RTL.** It opens in the visitor's browser language and switches to the language they write in: an Arabic, Persian or Urdu question flips the whole UI right-to-left.
- Streaming answers, citation chips and source list, tool status ("Checking available times…"), quick-reply suggestions for the enabled tools, a hand-off notice, and a conversation that survives page reloads (signed token in `localStorage`).
- Animated launcher, opening panel, typing dots and message entrance. Full screen on phones, and it respects `prefers-reduced-motion`.
- **Dashboard → Website Widget:** brand color, title, position, greeting per language, a live preview that answers with the real agent, one-click key creation with the embed code, and a sample website for testing.
- **Privacy:** visitors get a reduced event stream, with no uncited passages, relevance scores, tool arguments or results, model name or token counts. Messages are built with DOM APIs, never `innerHTML`, and links are limited to http(s).

## Dashboard

| Page | What it does |
|---|---|
| **Overview** | Greeting, today's numbers, "needs a human" alert, a setup checklist (knowledge, tools, testing, widget key, first visitor, team, tracing), latest conversations, upcoming appointments, last 7 days |
| **Conversations** | Team inbox for every channel: search, filters (needs human, unread, AI handling, resolved), unread markers, live updates. **Take over** pauses the AI; replying as a person takes over automatically; **Hand back to AI** and **Resolve**. If a resolved customer writes again, the conversation reopens and the AI answers |
| **Knowledge · Chat Playground · Agent Tools · Website Widget · Analytics** | Phases 2–7 |
| **Team** | Members and roles (owner / admin / member), invite links, pending invitations, leave or remove |
| **Settings** | Business name and default language, delete business (owner, type the name to confirm), profile, change password, logged-in devices, API keys |

The navigation has live inbox badges and a slide-in menu on phones.

**Live hand-over in the website chat:** a team member's reply appears in the visitor's widget within seconds, labelled with their **first name only**. While a person is handling the chat, the AI stays silent: the visitor's messages are saved for the team and not answered by the model. The widget checks for replies adaptively (4 s when a person is handling it, 8 s otherwise, 30 s while closed, 60 s in a background tab) and shows an unread badge on the chat button. Contact details a customer types (email or phone) are picked up for the inbox.

**Team security:** invite links are 256-bit random, stored only as SHA-256, valid for 7 days, single-use, and accepted only by the account with the invited email. Admins can't touch owners, and the last owner can't be removed or demoted. Changing your password signs out every other device.

## Quality, cost and speed

**Evaluation set** (`backend/evals/dataset.json`): 17 cases on a fictional dental clinic in all 8 languages. They cover grounded answers with citations, prices that must not be invented, out-of-scope questions, prompt injection, availability, two-step booking (with and without confirmation), order lookup with right and wrong contact details, and human hand-off. The checks are deterministic: language of the reply, required/forbidden content, no invented prices, sources cited, tools called, booking actually created, conversation status. Numbers are normalized across scripts (Arabic/Persian digits, `1.500` / `1,500`). An optional LLM judge (`--judge`) grades rubric cases.

```bash
cd backend && .venv\Scripts\python -m app.evals.run            # writes evals/reports/latest.md
.venv\Scripts\python -m app.evals.run --only fr-parking --min-pass 0.9
```

The first run found real problems that are now fixed and covered by tests: French questions full of English-looking words ("parking pour les patients") were answered in English; the model sometimes skipped the booking tool, so customers had to confirm twice; some answers lacked citations. Latest result: [`backend/evals/reports/latest.md`](backend/evals/reports/latest.md).

**Cost and speed per business:** every answer stores tokens, total latency, time to first word and an **estimated cost at list price** (configurable per model; the free tier really costs $0). Failed turns are logged by kind (quota, network, setup). The **Analytics** dashboard shows these per business, with deltas against the previous period: tiles with sparklines, answers and cost per day, p50/p95/first-word response time, languages, channels, tool usage, slowest answers, reliability, a side-by-side table of all your businesses, and the latest evaluation result.

**Langfuse tracing** (optional, free tier): set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` and every turn becomes a trace. Each trace has the model calls, tools and retrieval, with session = conversation, user = business, and tags for channel and language. Trace ids derive from the message id, so the dashboard links straight to a trace, and evaluation runs attach an `eval_pass` score to each case's trace. **Emails and phone numbers are masked before anything leaves the server.**

## Security

| Area | How it's protected |
|---|---|
| Passwords | Argon2id (64 MiB, t=3), auto-rehash; min 10 chars. Unknown email and wrong password get the same message and take the same time (dummy hash), so emails can't be enumerated |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); only its SHA-256 is stored. New token per login (no fixation), 14-day expiry, real logout |
| CSRF | Per-session synchronizer token, required in `X-CSRF-Token` on every non-GET request |
| Tenant isolation | Every `/tenants/{id}/…` route requires membership and returns **404** to non-members (no existence leak). Roles: owner > admin > member; config changes need admin |
| Brute force / abuse | Redis rate limits: login per IP and per account, sign-up per IP, widget per key and per visitor, server API per key. **Fails closed** if Redis is down |
| API keys | `pk_` publishable (chat only, only from listed origins) and `sk_` secret (server-to-server, can't chat). Shown once, SHA-256 stored, revocable, `last_used_at` tracked |
| Widget conversations | Continuing or restoring one needs an HMAC-signed conversation token; dashboard conversations can't be reached from the widget. Public events are stripped of internal data |
| AI tools | Tools are bound server-side to one tenant/conversation; bookings need confirmation in a later turn; order lookups need matching contact details |
| Ingestion | SSRF protection (private/loopback IPs blocked, redirects re-checked), PDF magic-byte and size checks |
| HTTP | Split CORS (dashboard with credentials, `/api/public` without), `nosniff`, `X-Frame-Options: DENY`, `no-store` on auth, no API docs in production, startup refuses insecure production config |

Automated: `tests/test_security.py` attacks every route without credentials and as another user, plus CSRF, roles, rate limits, key misuse, CORS and headers.

**Known gaps (planned):** email verification, password reset and invitation emails need an email provider (Phase 9). Until then invite links are shared by hand.

## Layout

```
backend/
  app/api/        FastAPI routes (tenants, documents, search, health)
  app/services/   extraction, chunking, embeddings, ingestion pipeline, search
  app/models/     SQLAlchemy models (Tenant, Document, Chunk with pgvector)
  migrations/     Alembic migrations
  app/evals/      evaluation runner and scoring
  evals/          evaluation dataset and the latest report
  tests/          pytest suite (uses a separate rehber_test database)
frontend/         Next.js landing page + admin dashboard
  public/widget.js       the embeddable chat widget (plain JS, no build step)
  public/widget-test.html  sample website for trying the widget
docker-compose.yml   Postgres (pgvector) + Redis
```

## Run locally

```bash
# 1. Databases (needs Docker Desktop running)
docker compose up -d

# 2. Backend
cd backend
copy .env.example .env               # then fill in keys
.venv\Scripts\activate
alembic upgrade head                 # create/upgrade tables
uvicorn app.main:app --reload        # API docs: http://localhost:8000/docs
# The first start downloads the embedding model (~1.2 GB) into backend/.models

# 3. Frontend
cd frontend
npm run dev                          # http://localhost:3000/dashboard  (Overview, Conversations, Knowledge, Chat Playground, Agent Tools, Website Widget, Analytics, Team, Settings)
```

Tests (one-time setup: `docker exec rehber-db-1 createdb -U rehber rehber_test`):
`cd backend && .venv\Scripts\python -m pytest`

## Roadmap

- [x] 1. Foundation: backend skeleton, DB models, Docker, animated landing page
- [x] 2. Document ingestion: PDF/URL/text upload, chunking, local embeddings into pgvector, search, Knowledge dashboard
- [x] 3. RAG chat: streaming answers (SSE), citations, language detection, conversation memory, Chat Playground
- [x] 4. LangGraph agent with tools: availability, two-step booking, order lookup, human hand-off, Agent Tools dashboard
- [x] 5. Security: accounts (Argon2id), HttpOnly sessions + CSRF, per-business roles, rate limits, widget/server API keys, signed widget conversations
- [x] 6. Embeddable chat widget + 8 languages (TR, EN, DE, RU, FR, AR, FA, UR; incl. RTL), live preview, sample site
- [x] 7. Evaluation set (17 cases, 8 languages), Langfuse tracing with PII masking, cost/speed/reliability analytics per business
- [x] 8. Full dashboard: overview, team inbox with live human take-over in the widget, team & invitations, business/account settings, mobile navigation
- [ ] 9. CI (GitHub Actions) and deploy online
- [ ] 10. WhatsApp channel
