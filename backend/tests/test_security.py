"""Security tests: authentication, sessions, CSRF, isolation, roles, rate limits, API keys, CORS."""

import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.core.config import Settings
from app.core.security import sha256
from app.db.session import SessionLocal
from app.main import app
from app.models import ApiKey, AuthSession, Membership, User
from tests.conftest import PASSWORD, login_as, new_client
from tests.test_chat import parse_sse

ORIGIN = "https://shop.example.com"


def all_routes():
    """Every (method, path) the API exposes, from the OpenAPI schema."""
    for path, ops in app.openapi()["paths"].items():
        for method in ops:
            yield method.upper(), path


def fill(path: str, tid: str | None = None) -> str:
    rand = str(uuid.uuid4())
    path = path.replace("{tenant_id}", tid or rand)
    return re.sub(r"\{[^}]+\}", rand, path)


async def make_biz(c, name="Biz"):
    return (await c.post("/api/tenants", json={"name": name})).json()["id"]


# ---------------------------------------------------------------- every route is protected

PUBLIC = {("GET", "/api/health"), ("GET", "/api/health/db"), ("POST", "/api/auth/signup"), ("POST", "/api/auth/login")}


async def test_every_non_public_route_requires_authentication(anon_client):
    checked = 0
    for method, path in all_routes():
        if (method, path) in PUBLIC:
            continue
        res = await anon_client.request(method, fill(path), json={} if method in ("POST", "PUT") else None)
        assert res.status_code in (401, 403), f"{method} {path} answered {res.status_code} without credentials"
        checked += 1
    assert checked >= 25  # make sure the inventory really ran


async def test_other_users_cannot_touch_my_business_on_any_route(client, fake_llm):
    tid = await make_biz(client, "Owner's Biz")
    async with new_client() as attacker:
        await login_as(attacker, "attacker@example.com")
        assert (await attacker.get("/api/tenants")).json() == []
        for method, path in all_routes():
            if "{tenant_id}" not in path:
                continue
            res = await attacker.request(method, fill(path, tid), json={} if method in ("POST", "PUT") else None)
            assert res.status_code == 404, f"{method} {path} -> {res.status_code} for a non-member"


# ---------------------------------------------------------------- sign up / log in


async def test_password_is_hashed_with_argon2_never_stored_plain(client):
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == "owner@example.com"))
    assert user.password_hash.startswith("$argon2id$") and PASSWORD not in user.password_hash


@pytest.mark.parametrize("payload, field", [
    ({"name": "A", "email": "not-an-email", "password": PASSWORD}, "email"),
    ({"name": "A", "email": "a@b.com", "password": "short"}, "password"),
    ({"name": "A", "email": "a@b.com", "password": "aaaaaaaaaaaa"}, "password"),
])
async def test_signup_validation(anon_client, payload, field):
    res = await anon_client.post("/api/auth/signup", json=payload)
    assert res.status_code == 422 and field in res.text


async def test_duplicate_email_and_case_insensitive_login(anon_client):
    await login_as(anon_client, "Mixed.Case@Example.com")
    async with new_client() as c:
        res = await c.post("/api/auth/signup", json={"name": "X", "email": "mixed.case@example.com", "password": PASSWORD})
        assert res.status_code == 409
        res = await c.post("/api/auth/login", json={"email": "MIXED.case@example.COM", "password": PASSWORD})
        assert res.status_code == 200


async def test_wrong_password_and_unknown_email_look_identical(client, anon_client):
    wrong = await anon_client.post("/api/auth/login", json={"email": "owner@example.com", "password": "wrong-password-123"})
    unknown = await anon_client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


async def test_session_cookie_is_httponly_and_token_is_stored_hashed(anon_client):
    res = await anon_client.post("/api/auth/signup", json={"name": "C", "email": "c@example.com", "password": PASSWORD})
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    token = anon_client.cookies.get("rehber_session")
    async with SessionLocal() as db:
        stored = (await db.scalars(select(AuthSession))).all()
    assert [s.token_hash for s in stored] == [sha256(token)] and token not in stored[0].token_hash


async def test_logout_kills_the_session(client):
    old_cookie = client.cookies.get("rehber_session")
    assert (await client.post("/api/auth/logout")).status_code == 204
    async with new_client() as c:
        c.cookies.set("rehber_session", old_cookie)
        assert (await c.get("/api/auth/me")).status_code == 401


async def test_expired_session_is_rejected(client):
    async with SessionLocal() as db:
        await db.execute(update(AuthSession).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_forged_cookie_is_rejected(anon_client):
    anon_client.cookies.set("rehber_session", "made-up-token")
    assert (await anon_client.get("/api/tenants")).status_code == 401


# ---------------------------------------------------------------- CSRF


async def test_state_changes_require_csrf_token(client):
    good = client.headers.pop("X-CSRF-Token")
    assert (await client.get("/api/tenants")).status_code == 200  # reads are fine
    assert (await client.post("/api/tenants", json={"name": "No CSRF"})).status_code == 403
    client.headers["X-CSRF-Token"] = "wrong"
    assert (await client.post("/api/tenants", json={"name": "Bad CSRF"})).status_code == 403
    client.headers["X-CSRF-Token"] = good
    assert (await client.post("/api/tenants", json={"name": "Good CSRF"})).status_code == 201


# ---------------------------------------------------------------- roles


async def test_members_can_read_and_chat_but_not_change_configuration(client, fake_llm):
    tid = await make_biz(client)
    async with new_client() as staff:
        me = await login_as(staff, "staff@example.com")
        async with SessionLocal() as db:
            db.add(Membership(user_id=uuid.UUID(me["id"]), tenant_id=uuid.UUID(tid), role="member"))
            await db.commit()

        assert (await staff.get(f"/api/tenants/{tid}/documents")).status_code == 200
        assert (await staff.post(f"/api/tenants/{tid}/chat", json={"message": "hi"})).status_code == 200
        settings = (await staff.get(f"/api/tenants/{tid}/settings")).json()
        assert (await staff.put(f"/api/tenants/{tid}/settings", json=settings)).status_code == 403
        assert (await staff.post(f"/api/tenants/{tid}/documents/text", json={"title": "t", "text": "x"})).status_code == 403
        assert (await staff.post(f"/api/tenants/{tid}/api-keys", json={"name": "k", "kind": "secret"})).status_code == 403
        assert (await staff.get(f"/api/tenants/{tid}/api-keys")).status_code == 403


# ---------------------------------------------------------------- rate limits


async def test_login_brute_force_is_rate_limited(client, anon_client):
    for _ in range(8):
        res = await anon_client.post("/api/auth/login", json={"email": "owner@example.com", "password": "guess-guess-1"})
        assert res.status_code == 401
    blocked = await anon_client.post("/api/auth/login", json={"email": "owner@example.com", "password": PASSWORD})
    assert blocked.status_code == 429 and "Retry-After" in blocked.headers  # even the right password waits


async def test_signup_is_rate_limited_per_network(anon_client):
    codes = [
        (await anon_client.post("/api/auth/signup", json={"name": "S", "email": f"s{i}@example.com", "password": PASSWORD})).status_code
        for i in range(6)
    ]
    assert codes[:5] == [201] * 5 and codes[5] == 429


# ---------------------------------------------------------------- API keys


async def create_key(client, tid, kind="publishable", origins=(ORIGIN,)):
    res = await client.post(f"/api/tenants/{tid}/api-keys", json={"name": "Site", "kind": kind, "allowed_origins": list(origins)})
    assert res.status_code == 201, res.text
    return res.json()


async def test_keys_are_shown_once_and_stored_hashed(client):
    tid = await make_biz(client)
    created = await create_key(client, tid)
    assert created["key"].startswith("pk_") and created["prefix"] == created["key"][:11]
    listed = (await client.get(f"/api/tenants/{tid}/api-keys")).json()
    assert "key" not in listed[0] and created["key"] not in str(listed)
    async with SessionLocal() as db:
        stored = await db.scalar(select(ApiKey))
    assert stored.key_hash == sha256(created["key"])


async def test_publishable_key_needs_valid_origins(client):
    tid = await make_biz(client)
    res = await client.post(f"/api/tenants/{tid}/api-keys", json={"name": "x", "kind": "publishable", "allowed_origins": []})
    assert res.status_code == 422
    res = await client.post(f"/api/tenants/{tid}/api-keys",
                            json={"name": "x", "kind": "publishable", "allowed_origins": ["https://shop.com/path"]})
    assert res.status_code == 422
    ok = await create_key(client, tid, origins=["HTTPS://Shop.Example.com/"])
    assert ok["allowed_origins"] == [ORIGIN]


async def widget_chat(key: str, message: str, origin: str = ORIGIN, **extra):
    async with new_client() as c:
        return await c.post("/api/public/chat", json={"message": message, **extra},
                            headers={"X-Rehber-Key": key, "Origin": origin})


async def test_widget_key_works_only_from_allowed_websites(client, fake_llm):
    tid = await make_biz(client)
    key = (await create_key(client, tid))["key"]

    ok = await widget_chat(key, "Hello")
    assert ok.status_code == 200
    meta = parse_sse(ok.text)[0][1]
    assert meta["conversation_token"]

    assert (await widget_chat(key, "Hello", origin="https://evil.example")).status_code == 403
    async with new_client() as c:  # no Origin header at all
        assert (await c.post("/api/public/chat", json={"message": "x"}, headers={"X-Rehber-Key": key})).status_code == 403
    assert (await widget_chat("pk_made_up", "Hello")).status_code == 401

    convos = (await client.get(f"/api/tenants/{tid}/conversations")).json()
    assert convos[0]["channel"] == "widget"


async def test_visitors_can_only_continue_their_own_conversation(client, fake_llm):
    tid = await make_biz(client)
    key = (await create_key(client, tid))["key"]
    first = parse_sse((await widget_chat(key, "Hi")).text)[0][1]
    other = parse_sse((await widget_chat(key, "Hi too")).text)[0][1]

    cont = await widget_chat(key, "More", conversation_id=first["conversation_id"], conversation_token=first["conversation_token"])
    assert cont.status_code == 200 and parse_sse(cont.text)[-1][0] == "done"

    stolen = await widget_chat(key, "Peek", conversation_id=first["conversation_id"], conversation_token=other["conversation_token"])
    assert stolen.status_code == 403
    assert (await widget_chat(key, "Peek", conversation_id=first["conversation_id"])).status_code == 403


async def test_widget_cannot_continue_dashboard_conversations(client, fake_llm):
    from app.core.security import sign

    tid = await make_biz(client)
    key = (await create_key(client, tid))["key"]
    res = await client.post(f"/api/tenants/{tid}/chat", json={"message": "staff test"})
    cid = parse_sse(res.text)[-1][1]["conversation_id"]
    # Even with a valid signature, a playground conversation is not reachable from the widget.
    res = await widget_chat(key, "x", conversation_id=cid, conversation_token=sign(cid, "widget-conversation"))
    assert res.status_code == 404


async def test_key_types_cannot_be_swapped_and_revocation_works(client, fake_llm):
    tid = await make_biz(client)
    pk = (await create_key(client, tid))["key"]
    sk_data = await create_key(client, tid, kind="secret", origins=())
    sk = sk_data["key"]
    order = [{"order_number": "A1", "status": "shipped", "total": "10.00", "customer_email": "a@b.com"}]

    async with new_client() as server:
        assert (await server.post("/api/v1/orders", json=order, headers={"Authorization": f"Bearer {sk}"})).status_code == 204
        assert (await server.post("/api/v1/orders", json=order, headers={"Authorization": f"Bearer {pk}"})).status_code == 401
    assert (await widget_chat(sk, "hi")).status_code == 401  # secret key can't chat
    assert [o["order_number"] for o in (await client.get(f"/api/tenants/{tid}/orders")).json()] == ["A1"]

    assert (await client.delete(f"/api/tenants/{tid}/api-keys/{sk_data['id']}")).status_code == 204
    async with new_client() as server:
        assert (await server.post("/api/v1/orders", json=order, headers={"Authorization": f"Bearer {sk}"})).status_code == 401


async def test_widget_messages_are_rate_limited_per_visitor(client, fake_llm):
    tid = await make_biz(client)
    key = (await create_key(client, tid))["key"]
    codes = [(await widget_chat(key, f"msg {i}")).status_code for i in range(16)]
    assert codes[:15] == [200] * 15 and codes[15] == 429


# ---------------------------------------------------------------- CORS and headers


async def test_cors_only_trusts_the_dashboard_with_cookies(anon_client):
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-csrf-token"}
    good = await anon_client.options("/api/tenants", headers={"Origin": "http://localhost:3000", **pre})
    assert good.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert good.headers.get("access-control-allow-credentials") == "true"

    evil = await anon_client.options("/api/tenants", headers={"Origin": "https://evil.example", **pre})
    assert "access-control-allow-origin" not in evil.headers

    public = await anon_client.options("/api/public/chat", headers={
        "Origin": "https://any-shop.example", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-rehber-key"})
    assert public.headers.get("access-control-allow-origin") == "*"
    assert "access-control-allow-credentials" not in public.headers


async def test_security_headers(anon_client):
    res = await anon_client.get("/api/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert (await anon_client.post("/api/auth/login", json={"email": "a@b.co", "password": "x"})).headers["cache-control"] == "no-store"


def test_production_refuses_insecure_defaults():
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        Settings(environment="production", secret_key="dev-insecure-change-me").check_production_safety()
    with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
        Settings(environment="production", secret_key="x" * 40).check_production_safety()
    Settings(environment="production", secret_key="x" * 40, cookie_secure=True).check_production_safety()
