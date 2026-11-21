"""Phase 10: WhatsApp channel - webhook security, answering, idempotency, team replies, connecting a number."""

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.db.session import SessionLocal
from app.models import Conversation, Message, WhatsAppAccount
from app.services import whatsapp as wa
from tests.conftest import login_as, new_client
from tests.test_chat import setup_biz

SECRET = "test-app-secret"
VERIFY = "test-verify-token"
PNID = "1234567890123"
TOKEN = "EAAGtestTOKEN1234567890abcdef"
CUSTOMER = "905321234567"


@pytest.fixture(autouse=True)
def wa_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "whatsapp_app_secret", SECRET)
    monkeypatch.setattr(s, "whatsapp_verify_token", VERIFY)


class FakeMeta:
    """Stands in for Meta's Graph API and records every call."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict | None]] = []
        self.fail: dict[str, wa.WhatsAppError] = {}  # path suffix -> error
        self.n = 0

    async def __call__(self, method, path, token, json=None, params=None):
        self.calls.append((method, path, json))
        for suffix, err in self.fail.items():
            if path.endswith(suffix) and (json is None or json.get("type") != "read"):
                raise err
        if method == "GET":
            return {"display_phone_number": "+1 555 0100", "verified_name": "Lumen Dental", "id": path}
        if path.endswith("/messages") and json and "status" not in json:
            self.n += 1
            return {"messages": [{"id": f"wamid.OUT{self.n}"}]}
        return {"success": True}

    @property
    def sent(self) -> list[dict]:
        return [j for m, p, j in self.calls if p.endswith("/messages") and j and j.get("type") == "text"]

    @property
    def reads(self) -> list[dict]:
        return [j for m, p, j in self.calls if j and j.get("status") == "read"]


@pytest.fixture
def meta(monkeypatch):
    fake = FakeMeta()
    monkeypatch.setattr(wa, "_graph", fake)
    return fake


def payload(text: str | None = "Are you open on Saturday?", msg_id: str = "wamid.IN1", kind: str = "text",
            pnid: str = PNID, sender: str = CUSTOMER, name: str = "Ayşe") -> dict:
    m = {"from": sender, "id": msg_id, "timestamp": "1790000000", "type": kind}
    if kind == "text":
        m["text"] = {"body": text}
    elif kind == "audio":
        m["audio"] = {"id": "media1", "mime_type": "audio/ogg"}
    return {"object": "whatsapp_business_account", "entry": [{"id": "WABA", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "15550100", "phone_number_id": pnid},
        "contacts": [{"profile": {"name": name}, "wa_id": sender}], "messages": [m]}}]}]}


def status_payload(msg_id: str, status: str, error: str | None = None) -> dict:
    s = {"id": msg_id, "status": status, "timestamp": "1790000001", "recipient_id": CUSTOMER}
    if error:
        s["errors"] = [{"code": 131026, "title": error}]
    return {"object": "whatsapp_business_account", "entry": [{"id": "WABA", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"phone_number_id": PNID}, "statuses": [s]}}]}]}


async def post_webhook(body: dict | bytes, secret: str = SECRET, signature: str | None = None):
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    sig = signature or "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    async with new_client() as c:
        return await c.post("/api/whatsapp/webhook", content=raw,
                            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig})


async def connect(client, tid, pnid=PNID):
    res = await client.put(f"/api/tenants/{tid}/whatsapp", json={"phone_number_id": pnid, "access_token": TOKEN,
                                                                  "waba_id": "998877"})
    assert res.status_code == 200, res.text
    return res.json()


async def wa_messages(tid=None):
    async with SessionLocal() as db:
        convo = await db.scalar(select(Conversation).where(Conversation.channel == "whatsapp"))
        msgs = (await db.scalars(select(Message).where(Message.conversation_id == convo.id)
                                 .order_by(Message.created_at))).all() if convo else []
        return convo, list(msgs)


# ---------------------------------------------------------------- webhook security


async def test_webhook_verification_handshake(anon_client):
    ok = await anon_client.get("/api/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": VERIFY,
                                                               "hub.challenge": "12345"})
    assert ok.status_code == 200 and ok.text == "12345"
    bad = await anon_client.get("/api/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "nope",
                                                                "hub.challenge": "12345"})
    assert bad.status_code == 403


async def test_webhook_rejects_unsigned_or_forged_calls(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    assert (await post_webhook(payload(), signature="sha256=" + "0" * 64)).status_code == 401
    assert (await post_webhook(payload(), secret="wrong-secret")).status_code == 401
    async with new_client() as c:
        assert (await c.post("/api/whatsapp/webhook", json=payload())).status_code == 401  # no signature at all
    assert meta.sent == [] and fake_llm.calls == []  # nothing was answered


async def test_webhook_off_when_server_not_configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "whatsapp_app_secret", "")
    assert (await post_webhook(payload(), secret="")).status_code == 503


# ---------------------------------------------------------------- answering


async def test_customer_message_is_answered_on_whatsapp(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    fake_llm.reply = "Yes, we are **open on Saturday** from 9 to 14 [1]."
    res = await post_webhook(payload())
    assert res.status_code == 200

    assert len(meta.reads) == 1 and meta.reads[0]["typing_indicator"] == {"type": "text"}  # blue ticks + typing
    assert len(meta.sent) == 1
    sent = meta.sent[0]
    assert sent["to"] == CUSTOMER
    assert sent["text"]["body"] == "Yes, we are *open on Saturday* from 9 to 14."  # WhatsApp bold, no [1]

    convo, msgs = await wa_messages()
    assert convo.tenant_id.hex == tid.replace("-", "")
    assert convo.customer_name == "Ayşe" and convo.customer_contact == "+" + CUSTOMER
    assert [m.role for m in msgs] == ["user", "assistant"]
    assert msgs[0].external_id == "wamid.IN1"
    assert msgs[1].external_id == "wamid.OUT1" and msgs[1].delivery == "sent"
    # The agent knows it's on WhatsApp and already has the customer's number.
    system = fake_llm.calls[0][0].content
    assert "WhatsApp" in system and "+" + CUSTOMER in system


async def test_retried_webhook_is_answered_once(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    await post_webhook(payload())
    await post_webhook(payload())  # Meta retries the same message
    from app.core.ratelimit import get_redis
    await get_redis().delete("wa:seen:wamid.IN1")  # even if the quick Redis check is lost...
    await post_webhook(payload())  # ...the unique database column still stops a second answer
    assert len(meta.sent) == 1
    _, msgs = await wa_messages()
    assert [m.role for m in msgs] == ["user", "assistant"]


async def test_follow_up_continues_the_same_conversation(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    await post_webhook(payload("Are you open on Saturday?", "wamid.A"))
    await post_webhook(payload("And on Sunday?", "wamid.B"))
    async with SessionLocal() as db:
        n = await db.scalar(select(Conversation.id).where(Conversation.channel == "whatsapp").limit(2))
        count = len((await db.scalars(select(Conversation).where(Conversation.channel == "whatsapp"))).all())
    assert n and count == 1
    assert len(meta.sent) == 2


async def test_unknown_number_and_other_business_are_kept_apart(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    await post_webhook(payload(pnid="999999999"))  # a number nobody connected
    assert meta.sent == [] and fake_llm.calls == []

    async with new_client() as other:
        await login_as(other, "other@example.com", "Other")
        tid2 = await setup_biz(other, "Other Biz")
        res = await other.put(f"/api/tenants/{tid2}/whatsapp", json={"phone_number_id": PNID, "access_token": TOKEN})
        assert res.status_code == 409  # one number can't be connected to two businesses


async def test_voice_note_gets_polite_text_only_reply(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    await post_webhook(payload(None, kind="audio"))
    assert fake_llm.calls == []
    assert meta.sent[0]["text"]["body"] == wa.TEXT_ONLY["en"]
    _, msgs = await wa_messages()
    assert msgs[0].content == "(sent a audio message)" and msgs[1].role == "assistant"


async def test_ai_failure_sends_friendly_message_in_customer_language(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    fake_llm.fail = True
    await post_webhook(payload("Merhaba, cumartesi günü açık mısınız?"))
    assert meta.sent[0]["text"]["body"] == wa.SORRY["tr"]
    assert "quota" not in meta.sent[0]["text"]["body"]


async def test_flood_is_saved_but_not_answered(client, meta, fake_llm, monkeypatch):
    monkeypatch.setattr(wa, "PER_CUSTOMER", (2, 60))
    tid = await setup_biz(client)
    await connect(client, tid)
    for i in range(4):
        await post_webhook(payload(f"Question {i} about Saturday", f"wamid.F{i}"))
    assert len(meta.sent) == 2
    _, msgs = await wa_messages()
    assert sum(m.role == "user" for m in msgs) == 4  # the team still sees every message


# ---------------------------------------------------------------- team take-over


async def test_team_reply_goes_to_whatsapp_and_ai_stays_quiet(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    await post_webhook(payload())
    convo, _ = await wa_messages()

    res = await client.post(f"/api/tenants/{tid}/conversations/{convo.id}/reply", json={"text": "Hi Ayşe, **Mehmet** here!"})
    assert res.status_code == 201, res.text
    assert res.json()["delivery"] == "sent"
    assert meta.sent[-1]["text"]["body"] == "Hi Ayşe, *Mehmet* here!"

    # The chat is taken over: the next customer message is saved but the AI doesn't answer.
    before = len(meta.sent)
    await post_webhook(payload("Thanks! What should I bring?", "wamid.IN2"))
    assert len(meta.sent) == before and meta.reads[-1:] == meta.reads[:1]  # no new read receipt/typing either

    listed = (await client.get(f"/api/tenants/{tid}/conversations")).json()[0]
    assert listed["customer_name"] == "Ayşe" and listed["channel"] == "whatsapp"
    assert listed["reply_window_ends_at"] is not None


async def test_team_reply_refused_after_24_hours(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    await post_webhook(payload())
    convo, _ = await wa_messages()
    async with SessionLocal() as db:
        await db.execute(update(Message).where(Message.conversation_id == convo.id)
                         .values(created_at=datetime.now(timezone.utc) - timedelta(hours=25)))
        await db.commit()
    before = len(meta.sent)
    res = await client.post(f"/api/tenants/{tid}/conversations/{convo.id}/reply", json={"text": "Hello?"})
    assert res.status_code == 409 and "24 hours" in res.json()["detail"]
    assert len(meta.sent) == before
    _, msgs = await wa_messages()
    assert not any(m.role == "staff" for m in msgs)  # nothing saved that the customer would never get


async def test_delivery_ticks_only_move_forward(client, meta, fake_llm):
    tid = await setup_biz(client)
    await connect(client, tid)
    await post_webhook(payload())
    await post_webhook(status_payload("wamid.OUT1", "read"))
    await post_webhook(status_payload("wamid.OUT1", "delivered"))  # arrives late
    _, msgs = await wa_messages()
    assert msgs[1].delivery == "read"

    await post_webhook(status_payload("wamid.OUT1", "failed", "Message undeliverable"))
    status = (await client.get(f"/api/tenants/{tid}/whatsapp")).json()
    assert "undeliverable" in status["account"]["last_error"]


# ---------------------------------------------------------------- connecting a number


async def test_connect_checks_with_meta_and_encrypts_token(client, meta):
    tid = await setup_biz(client)
    status = await connect(client, tid)
    assert status["connected"] and status["account"]["display_phone_number"] == "+1 555 0100"
    assert status["account"]["token_ok"] is True
    assert "access_token" not in json.dumps(status) and TOKEN not in json.dumps(status)
    assert status["webhook"]["url"].endswith("/api/whatsapp/webhook")
    assert status["webhook"]["verify_token"] == VERIFY and status["webhook"]["server_ready"] is True
    assert ("POST", "998877/subscribed_apps", None) in meta.calls

    async with SessionLocal() as db:
        acct = await db.scalar(select(WhatsAppAccount))
    assert TOKEN not in acct.token_encrypted and decrypt(acct.token_encrypted) == TOKEN


async def test_connect_reports_meta_errors(client, meta):
    tid = await setup_biz(client)
    meta.fail[PNID] = wa.WhatsAppError("Invalid OAuth access token.", 190, 401)
    res = await client.put(f"/api/tenants/{tid}/whatsapp", json={"phone_number_id": PNID, "access_token": TOKEN})
    assert res.status_code == 400 and "Invalid OAuth" in res.json()["detail"]
    assert (await client.get(f"/api/tenants/{tid}/whatsapp")).json()["connected"] is False
    bad = await client.put(f"/api/tenants/{tid}/whatsapp", json={"phone_number_id": "12ab", "access_token": TOKEN})
    assert bad.status_code == 422


async def test_only_admins_manage_whatsapp_and_see_verify_token(client, meta):
    tid = await setup_biz(client)
    await connect(client, tid)
    inv = (await client.post(f"/api/tenants/{tid}/invitations", json={"email": "member@example.com", "role": "member"})).json()
    async with new_client() as member:
        await login_as(member, "member@example.com", "Member")
        assert (await member.post(f"/api/invitations/{inv['token']}/accept")).status_code in (200, 204)
        status = (await member.get(f"/api/tenants/{tid}/whatsapp")).json()
        assert status["connected"] and status["webhook"]["verify_token"] is None
        assert (await member.delete(f"/api/tenants/{tid}/whatsapp")).status_code == 403
        assert (await member.put(f"/api/tenants/{tid}/whatsapp",
                                 json={"phone_number_id": PNID, "access_token": TOKEN})).status_code == 403


async def test_disconnect_and_test_message(client, meta):
    tid = await setup_biz(client)
    await connect(client, tid)
    ok = await client.post(f"/api/tenants/{tid}/whatsapp/test", json={"to": "+90 532 123 45 67"})
    assert ok.status_code == 200
    tmpl = [j for _, _, j in meta.calls if j and j.get("type") == "template"][0]
    assert tmpl["to"] == "905321234567" and tmpl["template"]["name"] == "hello_world"

    meta.fail["/messages"] = wa.WhatsAppError("Recipient phone number not in allowed list", 131030, 400)
    bad = await client.post(f"/api/tenants/{tid}/whatsapp/test", json={"to": "+44 7700 900123"})
    assert bad.status_code == 400 and "API Setup" in bad.json()["detail"]

    assert (await client.delete(f"/api/tenants/{tid}/whatsapp")).status_code == 204
    assert (await client.get(f"/api/tenants/{tid}/whatsapp")).json()["connected"] is False


# ---------------------------------------------------------------- formatting and helpers


def test_markdown_becomes_whatsapp_formatting():
    text = "### Hours\nWe are **open** Saturday [1][2]. See [our page](https://x.example/hours) [3]."
    cited = [{"n": 1, "title": "Hours", "url": "https://x.example/hours"}, {"n": 2, "title": "FAQ", "url": "https://x.example/faq"}]
    out = wa.to_whatsapp(text, cited)
    assert out.startswith("*Hours*\nWe are *open* Saturday.")
    assert "our page (https://x.example/hours)" in out
    assert "[1]" not in out and "[3]" not in out
    assert out.count("https://x.example/hours") == 1  # already in the text, not repeated
    assert out.endswith("🔗 FAQ: https://x.example/faq")


def test_long_answers_are_split_on_paragraphs():
    para = "word " * 300
    parts = wa.split_text(f"{para}\n\n{para}\n\n{para}", limit=3000)
    assert len(parts) == 2 and all(len(p) <= 3000 for p in parts)
    assert wa.split_text("") == []


def test_token_encryption_round_trip():
    enc = encrypt("secret-token")
    assert enc != "secret-token" and decrypt(enc) == "secret-token"
    assert decrypt("not-a-token") is None
