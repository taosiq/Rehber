# Rehber

AI support agent platform. A business uploads its documents (PDFs, website pages), and its customers chat with an AI agent that:

- answers from those documents (RAG) and cites its sources
- uses tools: books appointments, checks orders, hands over to a human
- answers in English, Turkish, Arabic or Urdu
- runs as a website chat widget, and later on WhatsApp

**Stack:** Python, FastAPI, LangGraph, PostgreSQL + pgvector, Redis, Claude (Anthropic), Voyage embeddings, Next.js dashboard, Docker, GitHub Actions.

## Layout

```
backend/    FastAPI API (app/api, app/models, app/db, app/core)
frontend/   Next.js landing page + admin dashboard
docker-compose.yml   Postgres (pgvector) + Redis
```

## Run locally

```bash
# 1. Databases (needs Docker Desktop)
docker compose up -d

# 2. Backend
cd backend
copy .env.example .env          # then fill in keys
.venv\Scripts\activate
uvicorn app.main:app --reload   # http://localhost:8000/docs

# 3. Frontend
cd frontend
npm run dev                     # http://localhost:3000
```

Tests: `cd backend && .venv\Scripts\python -m pytest`

## Roadmap

- [x] 1. Foundation: backend skeleton, DB models, Docker, animated landing page
- [ ] 2. Document ingestion: PDF/URL upload, chunking, embeddings into pgvector
- [ ] 3. RAG chat with streaming answers and source citations
- [ ] 4. LangGraph agent with tools (booking, orders, human handoff)
- [ ] 5. Multi-tenancy: auth, API keys, data kept separate per business
- [ ] 6. Embeddable chat widget + 4 languages (incl. RTL)
- [ ] 7. Evaluation set, Langfuse tracing, cost and speed tracking per business
- [ ] 8. Full admin dashboard
- [ ] 9. CI (GitHub Actions) and deploy online
- [ ] 10. WhatsApp channel
