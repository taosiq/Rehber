"""Cost, speed and quality numbers per business.

All numbers come from what each turn already records (tokens, latency, time to first token,
sources, tool calls, errors). Days are counted in the business's own timezone.
"""

import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_tenant
from app.core.config import get_settings
from app.db.session import get_db
from app.models import Tenant
from app.services import tracing
from app.services.business import load_settings

router = APIRouter(tags=["analytics"])


def _f(v) -> float:
    return float(v) if v is not None else 0.0


def _i(v) -> int | None:
    return int(round(float(v))) if v is not None else None


# One row of headline numbers for a set of tenants and a time window.
_TOTALS_SQL = """
WITH a AS (
    SELECT tenant_id, latency_ms, first_token_ms, prompt_tokens, completion_tokens, cost_usd,
           (json_typeof(sources) = 'array' AND json_array_length(sources) > 0) AS cited
    FROM messages
    WHERE role = 'assistant' AND tenant_id = ANY(:tids) AND created_at >= :start AND created_at < :end
)
SELECT t.id AS tenant_id,
    (SELECT count(*) FROM a WHERE a.tenant_id = t.id) AS answers,
    (SELECT count(*) FROM a WHERE a.tenant_id = t.id AND a.cited) AS cited,
    (SELECT coalesce(sum(prompt_tokens), 0) FROM a WHERE a.tenant_id = t.id) AS prompt_tokens,
    (SELECT coalesce(sum(completion_tokens), 0) FROM a WHERE a.tenant_id = t.id) AS completion_tokens,
    (SELECT coalesce(sum(cost_usd), 0) FROM a WHERE a.tenant_id = t.id) AS cost_usd,
    (SELECT avg(latency_ms) FROM a WHERE a.tenant_id = t.id) AS latency_avg,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FROM a WHERE a.tenant_id = t.id) AS latency_p50,
    (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM a WHERE a.tenant_id = t.id) AS latency_p95,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms) FROM a WHERE a.tenant_id = t.id) AS first_token_p50,
    (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms) FROM a WHERE a.tenant_id = t.id) AS first_token_p95,
    (SELECT count(*) FROM messages m WHERE m.tenant_id = t.id AND m.role = 'user'
        AND m.created_at >= :start AND m.created_at < :end) AS questions,
    (SELECT count(DISTINCT m.conversation_id) FROM messages m WHERE m.tenant_id = t.id
        AND m.created_at >= :start AND m.created_at < :end) AS conversations,
    (SELECT count(*) FROM agent_errors e WHERE e.tenant_id = t.id
        AND e.created_at >= :start AND e.created_at < :end) AS errors,
    (SELECT count(*) FROM conversations c WHERE c.tenant_id = t.id
        AND c.handoff_at >= :start AND c.handoff_at < :end) AS handoffs,
    (SELECT count(*) FROM appointments p WHERE p.tenant_id = t.id AND p.conversation_id IS NOT NULL
        AND p.created_at >= :start AND p.created_at < :end) AS bookings
FROM tenants t WHERE t.id = ANY(:tids)
"""


def _totals(row) -> dict:
    answers = row.answers or 0
    turns = answers + (row.errors or 0)
    cost = _f(row.cost_usd)
    return {
        "conversations": row.conversations or 0,
        "questions": row.questions or 0,
        "answers": answers,
        "errors": row.errors or 0,
        "error_rate": (row.errors or 0) / turns if turns else 0.0,
        "cited_rate": (row.cited or 0) / answers if answers else 0.0,
        "handoffs": row.handoffs or 0,
        "bookings": row.bookings or 0,
        "prompt_tokens": int(row.prompt_tokens or 0),
        "completion_tokens": int(row.completion_tokens or 0),
        "cost_usd": cost,
        "cost_per_answer_usd": cost / answers if answers else 0.0,
        "latency_ms": {"avg": _i(row.latency_avg), "p50": _i(row.latency_p50), "p95": _i(row.latency_p95)},
        "first_token_ms": {"p50": _i(row.first_token_p50), "p95": _i(row.first_token_p95)},
    }


async def _totals_for(db: AsyncSession, tids: list, start: datetime, end: datetime) -> dict:
    rows = (await db.execute(text(_TOTALS_SQL), {"tids": tids, "start": start, "end": end})).all()
    return {r.tenant_id: _totals(r) for r in rows}


def _window(days: int, tz: ZoneInfo) -> tuple[date, datetime, datetime]:
    """Whole local days: today and the `days - 1` before it."""
    today = datetime.now(tz).date()
    first = today - timedelta(days=days - 1)
    start = datetime.combine(first, datetime.min.time(), tz)
    end = datetime.combine(today + timedelta(days=1), datetime.min.time(), tz)
    return first, start, end


@router.get("/tenants/{tenant_id}/analytics")
async def tenant_analytics(
    days: int = Query(30, ge=1, le=90), tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
):
    tz_name = load_settings(tenant.settings).timezone
    tz = ZoneInfo(tz_name)
    first, start, end = _window(days, tz)
    prev_start = start - (end - start)
    p = {"tid": tenant.id, "start": start, "end": end, "tz": tz_name}

    current = (await _totals_for(db, [tenant.id], start, end))[tenant.id]
    previous = (await _totals_for(db, [tenant.id], prev_start, start))[tenant.id]

    daily_rows = (await db.execute(text("""
        SELECT (created_at AT TIME ZONE :tz)::date AS day,
               count(*) AS answers,
               coalesce(sum(cost_usd), 0) AS cost_usd,
               coalesce(sum(prompt_tokens + completion_tokens), 0) AS tokens,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY first_token_ms) AS ft50
        FROM messages
        WHERE tenant_id = :tid AND role = 'assistant' AND created_at >= :start AND created_at < :end
        GROUP BY day
    """), p)).all()
    conv_rows = (await db.execute(text("""
        SELECT (created_at AT TIME ZONE :tz)::date AS day, count(DISTINCT conversation_id) AS n
        FROM messages WHERE tenant_id = :tid AND created_at >= :start AND created_at < :end GROUP BY day
    """), p)).all()
    err_rows = (await db.execute(text("""
        SELECT (created_at AT TIME ZONE :tz)::date AS day, count(*) AS n
        FROM agent_errors WHERE tenant_id = :tid AND created_at >= :start AND created_at < :end GROUP BY day
    """), p)).all()
    by_day = {r.day: r for r in daily_rows}
    convs = {r.day: r.n for r in conv_rows}
    errs = {r.day: r.n for r in err_rows}
    daily = []
    for i in range(days):
        d = first + timedelta(days=i)
        r = by_day.get(d)
        daily.append({
            "date": d.isoformat(),
            "answers": r.answers if r else 0,
            "conversations": convs.get(d, 0),
            "errors": errs.get(d, 0),
            "cost_usd": _f(r.cost_usd) if r else 0.0,
            "tokens": int(r.tokens) if r else 0,
            "latency_p50": _i(r.p50) if r else None,
            "latency_p95": _i(r.p95) if r else None,
            "first_token_p50": _i(r.ft50) if r else None,
        })

    languages = (await db.execute(text("""
        SELECT coalesce(language, 'unknown') AS language, count(*) AS n FROM messages
        WHERE tenant_id = :tid AND role = 'user' AND created_at >= :start AND created_at < :end
        GROUP BY 1 ORDER BY n DESC
    """), p)).all()
    channels = (await db.execute(text("""
        SELECT c.channel, count(DISTINCT m.conversation_id) AS n FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.tenant_id = :tid AND m.created_at >= :start AND m.created_at < :end
        GROUP BY 1 ORDER BY n DESC
    """), p)).all()
    tools = (await db.execute(text("""
        SELECT tc->>'name' AS name, count(*) AS calls, count(*) FILTER (WHERE tc->>'status' = 'error') AS errors
        FROM messages m CROSS JOIN LATERAL json_array_elements(
            CASE WHEN json_typeof(m.tool_calls) = 'array' THEN m.tool_calls ELSE '[]'::json END) AS tc
        WHERE m.tenant_id = :tid AND m.role = 'assistant' AND json_typeof(m.tool_calls) = 'array'
          AND m.created_at >= :start AND m.created_at < :end
        GROUP BY 1 ORDER BY calls DESC
    """), p)).all()
    models = (await db.execute(text("""
        SELECT coalesce(model, 'unknown') AS model, count(*) AS answers, coalesce(sum(cost_usd), 0) AS cost_usd,
               bool_or(cost_usd IS NULL) AS unpriced
        FROM messages WHERE tenant_id = :tid AND role = 'assistant' AND created_at >= :start AND created_at < :end
        GROUP BY 1 ORDER BY answers DESC
    """), p)).all()
    error_kinds = (await db.execute(text("""
        SELECT kind, count(*) AS n FROM agent_errors
        WHERE tenant_id = :tid AND created_at >= :start AND created_at < :end GROUP BY 1 ORDER BY n DESC
    """), p)).all()
    slowest = (await db.execute(text("""
        SELECT m.id, m.conversation_id, m.latency_ms, m.first_token_ms, m.created_at, m.trace_id,
               (SELECT u.content FROM messages u WHERE u.conversation_id = m.conversation_id AND u.role = 'user'
                  AND u.created_at <= m.created_at ORDER BY u.created_at DESC LIMIT 1) AS question
        FROM messages m
        WHERE m.tenant_id = :tid AND m.role = 'assistant' AND m.latency_ms IS NOT NULL
          AND m.created_at >= :start AND m.created_at < :end
        ORDER BY m.latency_ms DESC LIMIT 5
    """), p)).all()

    return {
        "range": {"days": days, "from": first.isoformat(), "to": (end - timedelta(days=1)).date().isoformat(),
                  "timezone": tz_name},
        "totals": current,
        "previous": previous,
        "daily": daily,
        "languages": [{"language": r.language, "count": r.n} for r in languages],
        "channels": [{"channel": r.channel, "conversations": r.n} for r in channels],
        "tools": [{"name": r.name, "calls": r.calls, "errors": r.errors} for r in tools],
        "models": [{"model": r.model, "answers": r.answers, "cost_usd": _f(r.cost_usd), "priced": not r.unpriced}
                   for r in models],
        "error_kinds": [{"kind": r.kind, "count": r.n} for r in error_kinds],
        "slowest": [{
            "message_id": str(r.id), "conversation_id": str(r.conversation_id), "latency_ms": r.latency_ms,
            "first_token_ms": r.first_token_ms, "created_at": r.created_at.isoformat(),
            "question": (r.question or "")[:200],
            "trace_url": tracing.trace_url(r.trace_id) if r.trace_id else None,
        } for r in slowest],
        "tracing": {"enabled": tracing.enabled(), "base_url": get_settings().langfuse_base_url if tracing.enabled() else None},
    }


@router.get("/analytics/overview")
async def overview(
    days: int = Query(30, ge=1, le=90), current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Side-by-side numbers for every business the user belongs to (UTC days)."""
    rows = (await db.execute(text("""
        SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = :uid ORDER BY t.created_at
    """), {"uid": current.user.id})).all()
    if not rows:
        return {"days": days, "businesses": []}
    _, start, end = _window(days, ZoneInfo("UTC"))
    totals = await _totals_for(db, [r.id for r in rows], start, end)
    return {
        "days": days,
        "businesses": [{"tenant_id": str(r.id), "name": r.name, "role": r.role, **totals[r.id]} for r in rows],
    }



@router.get("/evals/latest")
async def latest_eval(current: CurrentUser = Depends(get_current_user)):
    """Summary of the most recent evaluation run (python -m app.evals.run). Fictional test data only."""
    from app.evals.run import REPORTS

    path = REPORTS / "latest.json"
    if not path.exists():
        return None
    report = json.loads(path.read_text(encoding="utf-8"))
    return {
        "model": report["model"], "started_at": report["started_at"], "judge": report["judge"],
        "summary": report["summary"],
        "cases": [{"id": c["id"], "language": c["language"], "tags": c["tags"], "passed": c["passed"],
                   "latency_ms": c["latency_ms"],
                   "failed": [f"{x['name']}: {x['detail']}" for x in c["checks"] if not x["passed"]]}
                  for c in report["cases"]],
    }
