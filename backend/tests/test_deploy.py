"""Phase 9: real client IP behind proxies, password reset, emails, production safety."""

import asyncio
import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update
from starlette.requests import Request

from app.core.config import Settings, get_settings
from app.core.net import client_ip
from app.db.session import SessionLocal
from app.models import PasswordReset
from app.services import email
from tests.conftest import PASSWORD, login_as, new_client
from tests.test_chat import chat, setup_biz

NEW_PW = "a-fresh-password-77"


@pytest.fixture(autouse=True)
def clean_outbox():
    email.OUTBOX.clear()
    yield
    email.OUTBOX.clear()


async def wait_for_mail(n: int = 1) -> list[email.Email]:
    for _ in range(50):  # reset emails are sent in the background
        if len(email.OUTBOX) >= n:
            break
        await asyncio.sleep(0.02)
    return email.OUTBOX


# ---------------------------------------------------------------- client IP


def req(peer: str, xff: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff else []
    return Request({"type": "http", "client": (peer, 1234), "headers": headers, "method": "GET", "path": "/"})


def test_client_ip_behind_our_proxies(monkeypatch):
    monkeypatch.setattr(get_settings(), "trust_proxy", False)
    assert client_ip(req("127.0.0.1", "203.0.113.9")) == "127.0.0.1"  # not trusted unless configured

    monkeypatch.setattr(get_settings(), "trust_proxy", True)
    assert client_ip(req("127.0.0.1", "203.0.113.9")) == "203.0.113.9"
    # The client tried to fake an address; the proxy appended the real one on the right.
    assert client_ip(req("127.0.0.1", "6.6.6.6, 203.0.113.9")) == "203.0.113.9"
    assert client_ip(req("172.18.0.3", "203.0.113.9, 127.0.0.1")) == "203.0.113.9"
    # A request that did NOT come through a local proxy can't choose its IP.
    assert client_ip(req("198.51.100.7", "1.2.3.4")) == "198.51.100.7"
    assert client_ip(req("127.0.0.1")) == "127.0.0.1"


# ---------------------------------------------------------------- forgot / reset password


async def test_password_reset_flow(client, anon_client):
    same = "If an account exists for that email, we've sent a link to reset the password."
    unknown = await anon_client.post("/api/auth/forgot", json={"email": "nobody@example.com"})
    assert unknown.status_code == 202 and unknown.json()["detail"] == same
    known = await anon_client.post("/api/auth/forgot", json={"email": "OWNER@example.com"})
    assert known.status_code == 202 and known.json()["detail"] == same  # identical answer

    mail = (await wait_for_mail())[0]
    assert mail.to == "owner@example.com" and "Reset your password" in mail.html
    token = re.search(r"/reset-password/([\w-]+)", mail.text).group(1)

    assert (await anon_client.post("/api/auth/reset", json={"token": token, "new_password": "aaaaaaaaaaaa"})).status_code == 422
    assert (await anon_client.post("/api/auth/reset", json={"token": token, "new_password": NEW_PW})).status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 401  # every device signed out
    assert (await anon_client.post("/api/auth/reset", json={"token": token, "new_password": NEW_PW})).status_code == 400

    async with new_client() as c:
        assert (await c.post("/api/auth/login", json={"email": "owner@example.com", "password": PASSWORD})).status_code == 401
        assert (await c.post("/api/auth/login", json={"email": "owner@example.com", "password": NEW_PW})).status_code == 200


async def test_reset_links_expire_and_only_newest_works(client, anon_client):
    await anon_client.post("/api/auth/forgot", json={"email": "owner@example.com"})
    await anon_client.post("/api/auth/forgot", json={"email": "owner@example.com"})
    mails = await wait_for_mail(2)
    first, second = (re.search(r"/reset-password/([\w-]+)", m.text).group(1) for m in mails[:2])
    assert (await anon_client.post("/api/auth/reset", json={"token": first, "new_password": NEW_PW})).status_code == 400

    async with SessionLocal() as db:
        await db.execute(update(PasswordReset).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    assert (await anon_client.post("/api/auth/reset", json={"token": second, "new_password": NEW_PW})).status_code == 400


async def test_forgot_password_is_rate_limited(anon_client):
    codes = [(await anon_client.post("/api/auth/forgot", json={"email": "a@example.com"})).status_code for _ in range(4)]
    assert codes == [202, 202, 202, 429]


# ---------------------------------------------------------------- emails


async def test_invitation_is_emailed(client):
    tid = (await client.post("/api/tenants", json={"name": "Lale <Clinic>"})).json()["id"]
    res = (await client.post(f"/api/tenants/{tid}/invitations", json={"email": "nurse@example.com"})).json()
    assert res["emailed"] is False  # console provider: nothing really left the server
    mail = email.OUTBOX[-1]
    assert mail.to == "nurse@example.com" and f"/invite/{res['token']}" in mail.text
    assert "Lale &lt;Clinic&gt;" in mail.html and "<Clinic>" not in mail.html  # names are escaped


async def test_owners_get_a_handoff_alert(client, fake_llm):
    tid = await setup_biz(client)
    fake_llm.script = [[("handoff_to_human", {"reason": "Wants a refund", "customer_contact": "+90 555 000 1111"})],
                       "A colleague will contact you."]
    events = await chat(client, tid, "I want a refund, please call me")
    cid = events[-1][1]["conversation_id"]
    alerts = [m for m in email.OUTBOX if "needs a human" in m.subject]
    assert len(alerts) == 1 and alerts[0].to == "owner@example.com"
    assert "Wants a refund" in alerts[0].text and f"/dashboard/conversations?c={cid}" in alerts[0].text
    # Already handed off: no second email for the next message.
    await chat(client, tid, "Hello?", conversation_id=cid)
    assert len([m for m in email.OUTBOX if "needs a human" in m.subject]) == 1


class FakeResponse:
    def __init__(self, status: int):
        self.status_code, self.text = status, "{}"


async def test_brevo_provider(monkeypatch):
    calls = []

    class FakeClient:
        def __init__(self, **kw): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): ...
        async def post(self, url, json, headers):
            calls.append((url, json, headers))
            return FakeResponse(201 if len(calls) == 1 else 400)

    s = get_settings()
    monkeypatch.setattr(s, "email_provider", "brevo")
    monkeypatch.setattr(s, "brevo_api_key", "xkeysib-test")
    monkeypatch.setattr(s, "email_from", "clinic@example.com")
    monkeypatch.setattr(email.httpx, "AsyncClient", FakeClient)
    msg = email.password_reset("a@example.com", "Ayşe", "https://x.ts.net/reset-password/t")
    assert await email.send(msg) is True
    url, payload, headers = calls[0]
    assert url == email.BREVO_URL and headers["api-key"] == "xkeysib-test"
    assert payload["sender"]["email"] == "clinic@example.com" and payload["to"] == [{"email": "a@example.com"}]
    assert await email.send(msg) is False  # provider error: reported, not raised
    assert email.OUTBOX == []


# ---------------------------------------------------------------- production safety


@pytest.mark.parametrize("override, message", [
    ({"public_url": "http://rehber.example"}, "PUBLIC_URL"),
    ({"email_provider": "brevo"}, "BREVO_API_KEY"),
])
def test_production_needs_https_url_and_email_settings(override, message):
    base = {"environment": "production", "secret_key": "x" * 48, "cookie_secure": True, "public_url": "https://r.ts.net"}
    with pytest.raises(RuntimeError, match=message):
        Settings(**(base | override)).check_production_safety()
    Settings(**base).check_production_safety()  # the good config passes


async def test_login_still_works_for_other_users_while_reset_pending(anon_client):
    async with new_client() as c:
        await login_as(c, "someone@example.com")
        await anon_client.post("/api/auth/forgot", json={"email": "someone@example.com"})
        assert (await c.get("/api/auth/me")).status_code == 200  # asking for a reset changes nothing yet
