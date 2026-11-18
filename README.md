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

## Layout

```
backend/
  app/api/        FastAPI routes (tenants, documents, search, health)
  app/services/   extraction, chunking, embeddings, ingestion pipeline, search
  app/models/     SQLAlchemy models (Tenant, Document, Chunk with pgvector)
  migrations/     Alembic migrations
  tests/          pytest suite (uses a separate rehber_test database)
frontend/         Next.js landing page + admin dashboard (Knowledge page)
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
npm run dev                          # http://localhost:3000/dashboard  (Knowledge, Chat Playground, Agent Tools)
```

Tests (one-time setup: `docker exec rehber-db-1 createdb -U rehber rehber_test`):
`cd backend && .venv\Scripts\python -m pytest`

## Roadmap

- [x] 1. Foundation: backend skeleton, DB models, Docker, animated landing page
- [x] 2. Document ingestion: PDF/URL/text upload, chunking, local embeddings into pgvector, search, Knowledge dashboard
- [x] 3. RAG chat: streaming answers (SSE), citations, language detection, conversation memory, Chat Playground
- [x] 4. LangGraph agent with tools: availability, two-step booking, order lookup, human hand-off, Agent Tools dashboard
- [ ] 5. Multi-tenancy: auth, API keys, data kept separate per business
- [ ] 6. Embeddable chat widget + 8 languages (TR, EN, DE, RU, FR, AR, FA, UR; incl. RTL)
- [ ] 7. Evaluation set, Langfuse tracing, cost and speed tracking per business
- [ ] 8. Full admin dashboard
- [ ] 9. CI (GitHub Actions) and deploy online
- [ ] 10. WhatsApp channel
