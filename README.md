# Rehber

AI support agent platform. A business uploads its documents (PDFs, website pages), and its customers chat with an AI agent that:

- answers from those documents (RAG) and cites its sources
- uses tools: books appointments, checks orders, hands over to a human
- answers in 8 languages: Turkish, English, German, Russian, French, Arabic, Persian, Urdu
- runs as a website chat widget, and later on WhatsApp

**Stack:** Python, FastAPI, LangGraph, PostgreSQL + pgvector, Redis, local multilingual embeddings (EmbeddingGemma via fastembed/ONNX), swappable chat LLM, Next.js dashboard, Docker, GitHub Actions.

## How retrieval works

```
PDF / URL / text ─▶ extract (pypdf, trafilatura) ─▶ chunk (~1000 chars, 150 overlap,
paragraph/sentence aware) ─▶ embed (EmbeddingGemma-300m, 768-d, runs locally on CPU)
─▶ pgvector (HNSW cosine index), every row tagged with tenant_id
                                          ▲
customer question (any language) ─▶ embed ┘ ─▶ top-k passages + document/page citations
```

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
npm run dev                          # http://localhost:3000/dashboard
```

Tests (one-time setup: `docker exec rehber-db-1 createdb -U rehber rehber_test`):
`cd backend && .venv\Scripts\python -m pytest`

## Roadmap

- [x] 1. Foundation: backend skeleton, DB models, Docker, animated landing page
- [x] 2. Document ingestion: PDF/URL/text upload, chunking, local embeddings into pgvector, search, Knowledge dashboard
- [ ] 3. RAG chat with streaming answers and source citations
- [ ] 4. LangGraph agent with tools (booking, orders, human handoff)
- [ ] 5. Multi-tenancy: auth, API keys, data kept separate per business
- [ ] 6. Embeddable chat widget + 8 languages (TR, EN, DE, RU, FR, AR, FA, UR; incl. RTL)
- [ ] 7. Evaluation set, Langfuse tracing, cost and speed tracking per business
- [ ] 8. Full admin dashboard
- [ ] 9. CI (GitHub Actions) and deploy online
- [ ] 10. WhatsApp channel
