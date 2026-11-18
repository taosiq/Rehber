"""Phase 6: website widget - appearance settings, config, privacy of public events, history, language hint."""

from datetime import date, timedelta

from tests.conftest import new_client
from tests.test_chat import parse_sse, setup_biz
from tests.test_security import ORIGIN, create_key, widget_chat

HEADERS = {"Origin": ORIGIN}


async def public_post(key: str, path: str, body: dict, origin: str = ORIGIN):
    async with new_client() as c:
        return await c.post(f"/api/public/{path}", json=body, headers={"X-Rehber-Key": key, "Origin": origin})


async def widget_config(key: str, origin: str = ORIGIN):
    async with new_client() as c:
        return await c.get("/api/public/widget-config", headers={"X-Rehber-Key": key, "Origin": origin})


# ---------------------------------------------------------------- appearance settings


async def test_widget_settings_default_and_save(client):
    tid = await setup_biz(client)
    s = (await client.get(f"/api/tenants/{tid}/settings")).json()
    assert s["widget"] == {"title": None, "color": "#f5b544", "position": "right", "greetings": {}, "suggestions": True}

    s["widget"] = {"title": "Lumen", "color": "#22AA88", "position": "left",
                   "greetings": {"tr": " Merhaba! ", "en": "   "}, "suggestions": False}
    saved = (await client.put(f"/api/tenants/{tid}/settings", json=s)).json()["widget"]
    assert saved["color"] == "#22aa88"
    assert saved["greetings"] == {"tr": "Merhaba!"}  # trimmed; empty ones dropped


async def test_widget_settings_are_validated(client):
    tid = await setup_biz(client)
    s = (await client.get(f"/api/tenants/{tid}/settings")).json()
    bad = [
        {"color": "red"},
        {"color": "#fff; background:url(x)"},  # these values end up in CSS, so only plain hex
        {"position": "top"},
        {"greetings": {"xx": "hi"}},
        {"greetings": {"en": "x" * 301}},
        {"title": "x" * 61},
    ]
    for patch in bad:
        res = await client.put(f"/api/tenants/{tid}/settings", json=s | {"widget": s["widget"] | patch})
        assert res.status_code == 422, patch


async def test_tool_settings_save_keeps_widget_settings(client):
    tid = await setup_biz(client)
    s = (await client.get(f"/api/tenants/{tid}/settings")).json()
    s["widget"]["color"] = "#123456"
    await client.put(f"/api/tenants/{tid}/settings", json=s)
    s["tools"]["orders"] = False
    after = (await client.put(f"/api/tenants/{tid}/settings", json=s)).json()
    assert after["widget"]["color"] == "#123456" and after["tools"]["orders"] is False


# ---------------------------------------------------------------- public config


async def test_widget_config_is_public_but_minimal(client):
    tid = await setup_biz(client)
    s = (await client.get(f"/api/tenants/{tid}/settings")).json()
    s["widget"]["title"] = "Lumen Help"
    s["tools"]["booking"] = False
    await client.put(f"/api/tenants/{tid}/settings", json=s)
    key = (await create_key(client, tid))["key"]

    cfg = (await widget_config(key)).json()
    assert cfg["business_name"] == "Lumen Dental"
    assert cfg["widget"]["title"] == "Lumen Help"
    assert cfg["tools"] == {"booking": False, "orders": True, "handoff": True}
    assert set(cfg) == {"business_name", "default_language", "widget", "tools"}  # no hours, services, timezone

    assert (await widget_config(key, origin="https://evil.example")).status_code == 403


# ---------------------------------------------------------------- what visitors receive


async def test_public_events_hide_internal_details(client, fake_llm):
    tid = await setup_biz(client)
    key = (await create_key(client, tid))["key"]
    events = parse_sse((await widget_chat(key, "Are you open on Saturday?")).text)
    kinds = [e for e, _ in events]
    assert kinds[0] == "meta" and kinds[-1] == "done" and "token" in kinds

    meta = events[0][1]
    assert set(meta) == {"conversation_id", "language", "conversation_token"}  # no retrieved passages
    done = events[-1][1]
    assert set(done) == {"message_id", "conversation_status", "ai_paused", "cited"}  # no model/tokens/latency
    assert done["cited"] == [{"n": 1, "title": "Opening hours", "page": None, "url": None}]
    raw = (await widget_chat(key, "Are you open on Saturday?")).text
    assert "Closed on Sunday" not in raw and "score" not in raw and "fake-model" not in raw


async def test_public_tool_events_have_no_arguments_or_results(client, fake_llm):
    tid = await setup_biz(client)
    key = (await create_key(client, tid))["key"]
    friday = (date.today() + timedelta(days=(4 - date.today().weekday()) % 7 or 7)).isoformat()
    fake_llm.script = [[("check_availability", {"date": friday})], "Free times: 09:00."]
    events = parse_sse((await widget_chat(key, "Free on Friday?")).text)
    tools = [d for e, d in events if e == "tool"]
    assert [t["status"] for t in tools] == ["running", "done"]
    assert all(set(t) == {"id", "name", "status"} for t in tools)


# ---------------------------------------------------------------- restoring a conversation


async def test_visitor_can_restore_own_history_only(client, fake_llm):
    tid = await setup_biz(client)
    key = (await create_key(client, tid))["key"]
    first = parse_sse((await widget_chat(key, "Are you open on Saturday?")).text)[0][1]
    other = parse_sse((await widget_chat(key, "Hello")).text)[0][1]

    ok = await public_post(key, "history", {"conversation_id": first["conversation_id"],
                                            "conversation_token": first["conversation_token"]})
    assert ok.status_code == 200
    body = ok.json()
    assert body["status"] == "open"
    assert [m["role"] for m in body["messages"]] == ["user", "assistant"]
    assert body["messages"][0]["content"] == "Are you open on Saturday?"
    assert body["messages"][1]["cited"][0]["title"] == "Opening hours"
    assert "content" not in body["messages"][1]["cited"][0]

    swapped = {"conversation_id": first["conversation_id"], "conversation_token": other["conversation_token"]}
    assert (await public_post(key, "history", swapped)).status_code == 403
    good = {"conversation_id": first["conversation_id"], "conversation_token": first["conversation_token"]}
    assert (await public_post(key, "history", good, origin="https://evil.example")).status_code == 403

    # Another business's key can't read it either, even with the right token.
    tid2 = await setup_biz(client, "Other Biz")
    key2 = (await create_key(client, tid2))["key"]
    assert (await public_post(key2, "history", good)).status_code == 404


# ---------------------------------------------------------------- language


async def test_widget_language_hint_used_for_unclear_messages(client, fake_llm):
    tid = await setup_biz(client)
    key = (await create_key(client, tid))["key"]
    meta = parse_sse((await widget_chat(key, "ok", language="ar")).text)[0][1]
    assert meta["language"] == "ar"
    # A clear message wins over the hint.
    meta = parse_sse((await widget_chat(key, "Bonjour, êtes-vous ouverts le samedi ?", language="ar")).text)[0][1]
    assert meta["language"] == "fr"
    assert (await widget_chat(key, "ok", language="xx")).status_code == 422
