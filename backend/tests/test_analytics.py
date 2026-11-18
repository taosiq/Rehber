"""Phase 7: cost estimates, analytics (per business), failed-turn tracking, Langfuse tracing hooks."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from langchain_core.callbacks import BaseCallbackHandler
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import AgentError, Message
from app.services import tracing
from app.services.pricing import estimate_cost
from tests.conftest import login_as, new_client
from tests.test_chat import chat, setup_biz
from tests.test_security import create_key, widget_chat


@pytest.fixture
def priced_fake(monkeypatch):
    """Give the fake model a price: $1 per 1M input tokens, $2 per 1M output tokens."""
    monkeypatch.setitem(get_settings().model_prices, "fake-model", (1.0, 2.0))


def test_estimate_cost():
    assert estimate_cost("openai/gpt-oss-120b", 1_000_000, 1_000_000) == Decimal("0.75")
    assert estimate_cost("openai/gpt-oss-120b", 2000, 500) == Decimal("0.0006")
    assert estimate_cost("some-unknown-model", 10, 10) is None


async def test_answers_store_cost(client, fake_llm, priced_fake):
    tid = await setup_biz(client)
    events = await chat(client, tid, "Are you open on Saturday?")
    done = events[-1][1]
    # 100 input + 20 output tokens at $1 / $2 per million
    assert done["cost_usd"] == pytest.approx((100 * 1 + 20 * 2) / 1e6)
    async with SessionLocal() as db:
        msg = await db.scalar(select(Message).where(Message.role == "assistant"))
    assert msg.cost_usd == Decimal("0.00014") and msg.trace_id is None  # tracing is off in tests


async def test_tenant_analytics_numbers(client, fake_llm, priced_fake):
    tid = await setup_biz(client)
    first = await chat(client, tid, "Are you open on Saturday?")
    await chat(client, tid, "And on Sunday?", conversation_id=first[-1][1]["conversation_id"])
    await chat(client, tid, "Hallo, haben Sie am Samstag geöffnet?")
    key = (await create_key(client, tid))["key"]
    await widget_chat(key, "Bonjour, êtes-vous ouverts samedi ?")

    res = await client.get(f"/api/tenants/{tid}/analytics?days=7")
    assert res.status_code == 200
    a = res.json()
    t = a["totals"]
    assert t["answers"] == 4 and t["questions"] == 4 and t["conversations"] == 3
    assert t["prompt_tokens"] == 400 and t["completion_tokens"] == 80
    assert t["cost_usd"] == pytest.approx(4 * 0.00014)
    assert t["cost_per_answer_usd"] == pytest.approx(0.00014)
    assert 0 < t["cited_rate"] <= 1 and t["errors"] == 0 and t["error_rate"] == 0.0
    assert t["latency_ms"]["p50"] is not None and t["first_token_ms"]["p95"] is not None
    assert a["previous"]["answers"] == 0

    assert len(a["daily"]) == 7 and a["daily"][-1]["answers"] == 4
    assert a["daily"][-1]["conversations"] == 3 and a["daily"][0]["latency_p50"] is None
    assert {l["language"]: l["count"] for l in a["languages"]} == {"en": 2, "de": 1, "fr": 1}
    assert {c["channel"]: c["conversations"] for c in a["channels"]} == {"playground": 2, "widget": 1}
    assert a["models"] == [{"model": "fake-model", "answers": 4, "cost_usd": pytest.approx(0.00056), "priced": True}]
    assert len(a["slowest"]) == 4 and a["slowest"][0]["question"]
    assert a["tracing"] == {"enabled": False, "base_url": None}
    assert a["range"]["timezone"] == "Europe/Istanbul"


async def test_unpriced_models_are_flagged(client, fake_llm):
    tid = await setup_biz(client)
    await chat(client, tid, "Are you open on Saturday?")
    a = (await client.get(f"/api/tenants/{tid}/analytics")).json()
    assert a["totals"]["cost_usd"] == 0 and a["models"][0]["priced"] is False


async def test_failed_turns_are_counted(client, fake_llm):
    tid = await setup_biz(client)
    await chat(client, tid, "Are you open on Saturday?")
    fake_llm.fail = True
    events = await chat(client, tid, "Are you open on Sunday?")
    assert events[-1][0] == "error"

    async with SessionLocal() as db:
        err = await db.scalar(select(AgentError))
    assert err.kind == "rate_limit" and "RateLimitError" in err.detail
    t = (await client.get(f"/api/tenants/{tid}/analytics")).json()
    assert t["totals"]["errors"] == 1 and t["totals"]["error_rate"] == 0.5
    a = (await client.get(f"/api/tenants/{tid}/analytics")).json()
    assert a["error_kinds"] == [{"kind": "rate_limit", "count": 1}] and a["daily"][-1]["errors"] == 1


async def test_tool_usage_and_bookings(client, fake_llm):
    tid = await setup_biz(client)
    d = date.today() + timedelta(days=1)
    while d.weekday() == 6:
        d += timedelta(days=1)
    fake_llm.script = [[("check_availability", {"date": d.isoformat()})], "Free times: 10:00."]
    await chat(client, tid, "Any free time tomorrow?")
    a = (await client.get(f"/api/tenants/{tid}/analytics")).json()
    assert a["tools"] == [{"name": "check_availability", "calls": 1, "errors": 0}]


async def test_analytics_are_private_per_business(client, fake_llm):
    tid = await setup_biz(client)
    await chat(client, tid, "Are you open on Saturday?")
    async with new_client() as other:
        await login_as(other, "intruder@example.com", "Intruder")
        assert (await other.get(f"/api/tenants/{tid}/analytics")).status_code == 404
        mine = (await other.get("/api/analytics/overview")).json()
        assert mine["businesses"] == []
    async with new_client() as anon:
        assert (await anon.get(f"/api/tenants/{tid}/analytics")).status_code == 401
        assert (await anon.get("/api/analytics/overview")).status_code == 401
    assert (await client.get(f"/api/tenants/{tid}/analytics?days=0")).status_code == 422
    assert (await client.get(f"/api/tenants/{tid}/analytics?days=91")).status_code == 422


async def test_overview_compares_my_businesses(client, fake_llm, priced_fake):
    a = await setup_biz(client, "Clinic A")
    b = await setup_biz(client, "Clinic B")
    await chat(client, a, "Are you open on Saturday?")
    await chat(client, a, "Are you open on Saturday?")
    await chat(client, b, "Are you open on Saturday?")
    res = (await client.get("/api/analytics/overview?days=30")).json()
    rows = {r["name"]: r for r in res["businesses"]}
    assert rows["Clinic A"]["answers"] == 2 and rows["Clinic B"]["answers"] == 1
    assert rows["Clinic A"]["cost_usd"] == pytest.approx(2 * rows["Clinic B"]["cost_usd"])
    assert rows["Clinic A"]["role"] == "owner"


# ---------------------------------------------------------------- tracing


def test_mask_pii():
    out = tracing.mask_pii({"q": "Mail me at ayse.yilmaz@example.com or call +90 532 123 45 67",
                            "list": ["order 12345", "(0212) 555-1234"], "n": 5})
    assert out["q"] == "Mail me at [email] or call [phone]"
    assert out["list"] == ["order 12345", "[phone]"]  # short numbers like order ids stay
    assert out["n"] == 5


def test_tracing_off_without_keys():
    assert tracing.enabled() is False
    assert tracing.turn_config(seed="x", tenant_id="t", tenant_name="T", conversation_id="c",
                               channel="widget", language="tr") == ({}, None)


def test_tracing_config_when_keys_are_set(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "langfuse_public_key", "pk-lf-test")
    monkeypatch.setattr(s, "langfuse_secret_key", "sk-lf-test")
    monkeypatch.setattr(s, "langfuse_base_url", "http://127.0.0.1:9")  # nothing listens here
    cfg, trace_id = tracing.turn_config(seed="msg-1", tenant_id="t1", tenant_name="Clinic", conversation_id="c1",
                                        channel="widget", language="tr")
    assert len(trace_id) == 32 and trace_id == tracing.trace_id_for("msg-1")  # stable per message
    assert cfg["metadata"]["langfuse_session_id"] == "c1"
    assert cfg["metadata"]["langfuse_user_id"] == "business:t1"
    assert set(cfg["metadata"]["langfuse_tags"]) == {"channel:widget", "lang:tr"}
    assert len(cfg["callbacks"]) == 1


class Recorder(BaseCallbackHandler):
    def __init__(self):
        self.model_calls = 0

    def on_chat_model_start(self, *args, **kwargs):
        self.model_calls += 1


async def test_runner_passes_trace_callbacks_and_stores_trace_id(client, fake_llm, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(tracing, "turn_config", lambda **kw: ({"callbacks": [rec]}, "a" * 32))
    tid = await setup_biz(client)
    events = await chat(client, tid, "Are you open on Saturday?")
    assert rec.model_calls == 1
    assert events[-1][1]["trace_id"] == "a" * 32
    async with SessionLocal() as db:
        msg = await db.scalar(select(Message).where(Message.role == "assistant"))
    assert msg.trace_id == "a" * 32


async def test_latest_eval_needs_login(client, anon_client, monkeypatch, tmp_path):
    import app.evals.run as run

    monkeypatch.setattr(run, "REPORTS", tmp_path)
    assert (await anon_client.get("/api/evals/latest")).status_code == 401
    assert (await client.get("/api/evals/latest")).json() is None
    report = {"model": "m", "started_at": "2026-11-18T00:00:00", "judge": False, "summary": {"cases": 1, "passed": 1},
              "cases": [{"id": "c1", "language": "en", "tags": ["x"], "passed": True, "latency_ms": 5,
                         "answer": "secret-ish full answer", "checks": [{"name": "cites", "passed": True, "detail": ""}]}]}
    (tmp_path / "latest.json").write_text(__import__("json").dumps(report), encoding="utf-8")
    body = (await client.get("/api/evals/latest")).json()
    assert body["cases"][0] == {"id": "c1", "language": "en", "tags": ["x"], "passed": True, "latency_ms": 5, "failed": []}
