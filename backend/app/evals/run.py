"""Run the evaluation set against the real agent and write a report.

    python -m app.evals.run                    # all cases
    python -m app.evals.run --only en-hours-saturday tr-price-cleaning
    python -m app.evals.run --judge            # also grade rubric cases with the LLM
    python -m app.evals.run --min-pass 0.8     # exit code 1 below 80% (for CI)

It creates a temporary business (no members, invisible in the dashboard), loads the documents,
runs every case through the same code path as real customers, scores the answers, and deletes
the business again (unless --keep). Reports go to backend/evals/reports/.
"""

import argparse
import asyncio
import json
import re
import statistics
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import delete, func, select

from app.api.business import OrderIn, _upsert_orders
from app.api.tenants import _slugify
from app.core.config import BACKEND_DIR, get_settings
from app.db.session import SessionLocal
from app.evals.scoring import TurnResult, score_case
from app.models import Appointment, Document, Message, Tenant
from app.services import tracing
from app.services.agent.model import get_chat_model
from app.services.agent.runner import run_turn
from app.services.business import BusinessSettings
from app.services.extraction import Extracted, Page
from app.services.ingestion import ingest_document

DATASET = BACKEND_DIR / "evals" / "dataset.json"
REPORTS = BACKEND_DIR / "evals" / "reports"


def _fill(text: str, now: datetime) -> str:
    """Placeholders: {next_open_day} = a weekday 2+ days ahead, e.g. "Tuesday 2026-11-24"."""
    d = now.date() + timedelta(days=2)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return text.replace("{next_open_day}", f"{d.strftime('%A')} {d.isoformat()}")


async def setup_business(spec: dict) -> uuid.UUID:
    settings = BusinessSettings.model_validate(spec.get("settings") or {})
    async with SessionLocal() as db:
        tenant = Tenant(name=spec["name"], slug=_slugify(spec["name"]), settings=settings.model_dump())
        db.add(tenant)
        await db.flush()
        docs = []
        for d in spec["documents"]:
            doc = Document(tenant_id=tenant.id, title=d["title"], source_type="text", status="pending")
            db.add(doc)
            docs.append((doc, d["text"]))
        await db.flush()
        if spec.get("orders"):
            await _upsert_orders(db, tenant.id, [OrderIn.model_validate(o) for o in spec["orders"]])
        await db.commit()
        tid = tenant.id
    for doc, body in docs:
        async def extract(title=doc.title, body=body):
            return Extracted(title=title, pages=[Page(text=body)])
        await ingest_document(doc.id, extract)
    async with SessionLocal() as db:
        bad = await db.scalar(select(func.count()).where(Document.tenant_id == tid, Document.status != "ready"))
    if bad:
        raise RuntimeError("Some evaluation documents failed to ingest.")
    return tid


async def drop_business(tid: uuid.UUID) -> None:
    async with SessionLocal() as db:
        await db.execute(delete(Tenant).where(Tenant.id == tid))
        await db.commit()


async def run_turn_collect(tid: uuid.UUID, question: str, conversation_id: uuid.UUID | None) -> TurnResult:
    r = TurnResult()
    parts: list[str] = []
    async with SessionLocal() as db:
        tenant = await db.get(Tenant, tid)
        async for ev in run_turn(db, tenant, question, conversation_id, channel="eval"):
            d = ev["data"]
            if ev["event"] == "meta":
                r.language = d.get("language")
                r.conversation_id = d["conversation_id"]
            elif ev["event"] == "token":
                parts.append(d["text"])
            elif ev["event"] == "error":
                r.error = d["message"]
            elif ev["event"] == "done":
                r.cited = d["cited"]
                r.tools = [c["name"] for c in d["tool_calls"]]
                r.latency_ms, r.first_token_ms = d["latency_ms"], d["first_token_ms"]
                r.prompt_tokens, r.completion_tokens = d["prompt_tokens"], d["completion_tokens"]
                r.cost_usd = d.get("cost_usd") or 0.0
                r.trace_id = d.get("trace_id")
                r.status = d["conversation_status"]
    r.answer = "".join(parts).strip()
    return r


async def _drop_dangling_question(conversation_id: str) -> None:
    """After a failed turn the question is saved without an answer; remove it before retrying."""
    async with SessionLocal() as db:
        last = await db.scalar(select(Message).where(Message.conversation_id == uuid.UUID(conversation_id))
                               .order_by(Message.created_at.desc()).limit(1))
        if last is not None and last.role == "user":
            await db.delete(last)
            await db.commit()


async def judge(rubric: str, question: str, answer: str) -> tuple[bool, str]:
    model = get_chat_model()
    reply = await model.ainvoke([
        SystemMessage("You grade answers of a customer-support assistant. Reply with JSON only: "
                      '{"pass": true or false, "reason": "<one sentence>"}'),
        HumanMessage(f"Rubric: {rubric}\n\nCustomer question: {question}\n\nAssistant answer: {answer}"),
    ])
    text = reply.content if isinstance(reply.content, str) else str(reply.content)
    m = re.search(r"\{.*\}", text, re.S)
    try:
        data = json.loads(m.group(0)) if m else {}
        return bool(data.get("pass")), str(data.get("reason", ""))[:300]
    except json.JSONDecodeError:
        return False, f"judge reply was not JSON: {text[:120]}"


async def run_case(tid: uuid.UUID, case: dict, *, now: datetime, use_judge: bool, retries: int, log) -> dict:
    turns: list[TurnResult] = []
    conversation_id: uuid.UUID | None = None
    for raw in case["turns"]:
        question = _fill(raw, now)
        for attempt in range(retries + 1):
            r = await run_turn_collect(tid, question, conversation_id)
            cid = r.conversation_id
            if r.error and "quota" in r.error.lower() and attempt < retries:
                wait = 20 * (attempt + 1)
                log(f"    rate limited, waiting {wait}s…")
                if cid:
                    await _drop_dangling_question(cid)
                await asyncio.sleep(wait)
                continue
            break
        if cid:
            conversation_id = uuid.UUID(cid)
        turns.append(r)
        if r.error:
            break

    booked = 0
    if conversation_id:
        async with SessionLocal() as db:
            booked = await db.scalar(select(func.count()).where(
                Appointment.conversation_id == conversation_id, Appointment.status == "confirmed")) or 0

    checks = score_case(case, turns, booked)
    if use_judge and case.get("rubric") and not any(t.error for t in turns):
        ok, reason = await judge(case["rubric"], _fill(case["turns"][-1], now), turns[-1].answer)
        checks.append(("judge", ok, reason))
    passed = all(ok for _, ok, _ in checks)

    last = turns[-1]
    if last.trace_id:
        failed = "; ".join(f"{n}: {d}" for n, ok, d in checks if not ok)
        tracing.score(last.trace_id, "eval_pass", 1.0 if passed else 0.0, comment=failed or "all checks passed")
    return {
        "id": case["id"], "language": case.get("language"), "tags": case.get("tags", []), "passed": passed,
        "checks": [{"name": n, "passed": ok, "detail": d} for n, ok, d in checks],
        "question": _fill(case["turns"][-1], now), "answer": last.answer,
        "latency_ms": last.latency_ms, "first_token_ms": last.first_token_ms,
        "tokens": sum(t.prompt_tokens + t.completion_tokens for t in turns),
        "cost_usd": sum(t.cost_usd for t in turns),
        "trace_url": tracing.trace_url(last.trace_id) if last.trace_id else None,
    }


def _pct(values: list[int], q: float) -> int | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    return int(statistics.quantiles(values, n=100, method="inclusive")[int(q * 100) - 1])


def summarize(results: list[dict]) -> dict:
    def group(key):
        out: dict[str, dict] = {}
        for r in results:
            for k in ([r[key]] if key == "language" else r[key]):
                g = out.setdefault(k or "?", {"passed": 0, "total": 0})
                g["total"] += 1
                g["passed"] += r["passed"]
        return out

    by_check: dict[str, dict] = {}
    for r in results:
        for c in r["checks"]:
            g = by_check.setdefault(c["name"], {"passed": 0, "total": 0})
            g["total"] += 1
            g["passed"] += c["passed"]
    lat = [r["latency_ms"] for r in results if r["latency_ms"]]
    ft = [r["first_token_ms"] for r in results if r["first_token_ms"]]
    passed = sum(r["passed"] for r in results)
    return {
        "cases": len(results), "passed": passed, "pass_rate": passed / len(results) if results else 0.0,
        "by_tag": group("tags"), "by_language": group("language"), "by_check": by_check,
        "latency_ms": {"p50": _pct(lat, 0.5), "p95": _pct(lat, 0.95)},
        "first_token_ms": {"p50": _pct(ft, 0.5), "p95": _pct(ft, 0.95)},
        "tokens": sum(r["tokens"] for r in results), "cost_usd": sum(r["cost_usd"] for r in results),
    }


async def run_eval(dataset_path: Path = DATASET, *, only: list[str] | None = None, use_judge: bool = False,
                   pause: float = 6.0, retries: int = 3, keep: bool = False, log=print) -> dict:
    data = json.loads(dataset_path.read_text(encoding="utf-8"))
    cases = [c for c in data["cases"] if not only or c["id"] in only]
    started = time.perf_counter()
    tz = ZoneInfo((data["business"].get("settings") or {}).get("timezone", "Europe/Istanbul"))
    now = datetime.now(tz)
    log(f"Setting up '{data['business']['name']}' with {len(data['business']['documents'])} documents…")
    tid = await setup_business(data["business"])
    results = []
    try:
        for i, case in enumerate(cases, 1):
            if i > 1 and pause:
                await asyncio.sleep(pause)  # the free AI tier allows only a few requests per minute
            res = await run_case(tid, case, now=now, use_judge=use_judge, retries=retries, log=log)
            results.append(res)
            mark = "PASS" if res["passed"] else "FAIL"
            log(f"[{i:>2}/{len(cases)}] {mark}  {case['id']}  ({res['latency_ms'] or '-'} ms)")
            for c in res["checks"]:
                if not c["passed"]:
                    log(f"         - {c['name']}: {c['detail']}")
    finally:
        if not keep:
            await drop_business(tid)
        tracing.flush()
    return {
        "dataset_version": data.get("version"), "model": get_settings().chat_model,
        "judge": use_judge, "started_at": datetime.now(timezone.utc).isoformat(),
        "duration_s": round(time.perf_counter() - started, 1),
        "summary": summarize(results), "cases": results,
    }


def to_markdown(report: dict) -> str:
    s = report["summary"]
    lines = [
        "# Rehber evaluation report", "",
        f"Model `{report['model']}` · {report['started_at'][:16].replace('T', ' ')} UTC · "
        f"{report['duration_s']} s · LLM judge: {'on' if report['judge'] else 'off'}", "",
        f"**{s['passed']}/{s['cases']} cases passed ({s['pass_rate']:.0%})** · "
        f"answer p50 {s['latency_ms']['p50']} ms, p95 {s['latency_ms']['p95']} ms · "
        f"first word p50 {s['first_token_ms']['p50']} ms · {s['tokens']:,} tokens · est. ${s['cost_usd']:.4f}", "",
        "| Area | Passed |", "|---|---|",
        *[f"| {k} | {v['passed']}/{v['total']} |" for k, v in sorted(s["by_tag"].items())],
        "", "| Language | Passed |", "|---|---|",
        *[f"| {k} | {v['passed']}/{v['total']} |" for k, v in sorted(s["by_language"].items())],
        "", "| Case | Result | Latency | Notes |", "|---|---|---|---|",
    ]
    for c in report["cases"]:
        notes = "; ".join(f"{x['name']}: {x['detail']}" for x in c["checks"] if not x["passed"]) or ""
        lines.append(f"| `{c['id']}` | {'✅' if c['passed'] else '❌'} | {c['latency_ms'] or '-'} ms | {notes.replace('|', '/')} |")
    return "\n".join(lines) + "\n"


def write_report(report: dict, out_dir: Path = REPORTS) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    (out_dir / f"eval-{stamp}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md = to_markdown(report)
    (out_dir / "latest.md").write_text(md, encoding="utf-8")
    return out_dir / "latest.md"


def main() -> None:
    p = argparse.ArgumentParser(description="Run the Rehber evaluation set.")
    p.add_argument("--only", nargs="*", help="case ids to run")
    p.add_argument("--judge", action="store_true", help="grade rubric cases with the LLM (uses more quota)")
    p.add_argument("--pause", type=float, default=6.0, help="seconds between cases (free-tier rate limits)")
    p.add_argument("--keep", action="store_true", help="keep the temporary business for inspection")
    p.add_argument("--min-pass", type=float, default=0.0, help="exit with code 1 below this pass rate")
    args = p.parse_args()
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    report = asyncio.run(run_eval(only=args.only, use_judge=args.judge, pause=args.pause, keep=args.keep))
    path = write_report(report)
    s = report["summary"]
    print(f"\n{s['passed']}/{s['cases']} passed ({s['pass_rate']:.0%}) · p50 {s['latency_ms']['p50']} ms · "
          f"est. ${s['cost_usd']:.4f} · report: {path}")
    if s["pass_rate"] < args.min_pass:
        sys.exit(1)


if __name__ == "__main__":
    main()
