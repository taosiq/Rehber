"""Phase 8: inbox (take-over, staff replies, unread, search), team & invitations, account, business settings."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.db.session import SessionLocal
from app.models import Invitation
from tests.conftest import PASSWORD, login_as, new_client
from tests.test_chat import chat, setup_biz
from tests.test_security import create_key, widget_chat, ORIGIN
from tests.test_chat import parse_sse


async def convo_of(events) -> str:
    return events[-1][1]["conversation_id"]


# ---------------------------------------------------------------- inbox


async def test_take_over_pauses_the_ai_and_hand_back_resumes(client, fake_llm):
    tid = await setup_biz(client)
    cid = await convo_of(await chat(client, tid, "Are you open on Saturday?"))
    calls = len(fake_llm.calls)

    res = await client.post(f"/api/tenants/{tid}/conversations/{cid}/takeover")
    assert res.status_code == 200
    body = res.json()
    assert body["ai_paused"] and body["status"] == "handoff" and body["assigned_to"]["name"] == "Owner"

    events = await chat(client, tid, "Hello? Anyone there?", conversation_id=cid)
    assert [e for e, _ in events] == ["meta", "done"] and events[-1][1]["ai_paused"] is True
    assert len(fake_llm.calls) == calls  # the model was not called
    msgs = (await client.get(f"/api/tenants/{tid}/conversations/{cid}/messages")).json()
    assert msgs[-1]["role"] == "user" and msgs[-1]["content"] == "Hello? Anyone there?"

    res = await client.post(f"/api/tenants/{tid}/conversations/{cid}/release")
    assert res.json()["ai_paused"] is False and res.json()["status"] == "open"
    events = await chat(client, tid, "Are you open on Sunday?", conversation_id=cid)
    assert any(e == "token" for e, _ in events)


async def test_staff_reply_takes_over_and_reaches_the_widget(client, fake_llm):
    tid = await setup_biz(client)
    key = (await create_key(client, tid))["key"]
    meta = parse_sse((await widget_chat(key, "Are you open on Saturday?")).text)[0][1]
    cid, token = meta["conversation_id"], meta["conversation_token"]

    res = await client.post(f"/api/tenants/{tid}/conversations/{cid}/reply", json={"text": "Hi, this is Ayşe from the clinic!"})
    assert res.status_code == 201 and res.json()["role"] == "staff" and res.json()["author_name"] == "Owner"
    convo = (await client.get(f"/api/tenants/{tid}/conversations/{cid}")).json()
    assert convo["ai_paused"] and convo["status"] == "handoff" and convo["unread"] is False

    async with new_client() as c:
        hist = (await c.post("/api/public/history", json={"conversation_id": cid, "conversation_token": token},
                             headers={"X-Rehber-Key": key, "Origin": ORIGIN})).json()
    assert hist["ai_paused"] is True
    staff = hist["messages"][-1]
    assert staff["role"] == "staff" and staff["author"] == "Owner" and staff["content"].startswith("Hi, this is")
    assert "email" not in str(staff) and all(m["id"] for m in hist["messages"])

    # The visitor writes back: saved, no AI answer, and the done event tells the widget a person is handling it.
    events = parse_sse((await widget_chat(key, "Great, thanks!", conversation_id=cid, conversation_token=token)).text)
    assert [e for e, _ in events] == ["meta", "done"] and events[-1][1]["ai_paused"] is True


async def test_resolve_then_customer_returns_reopens(client, fake_llm):
    tid = await setup_biz(client)
    cid = await convo_of(await chat(client, tid, "Are you open on Saturday?"))
    await client.post(f"/api/tenants/{tid}/conversations/{cid}/takeover")
    assert (await client.post(f"/api/tenants/{tid}/conversations/{cid}/resolve")).status_code == 204
    c = (await client.get(f"/api/tenants/{tid}/conversations/{cid}")).json()
    assert c["status"] == "resolved" and c["ai_paused"] is False and c["assigned_to"] is None
    events = await chat(client, tid, "One more question", conversation_id=cid)
    assert any(e == "token" for e, _ in events)  # the AI answers again
    assert (await client.get(f"/api/tenants/{tid}/conversations/{cid}")).json()["status"] == "open"


async def test_unread_seen_and_counts(client, fake_llm):
    tid = await setup_biz(client)
    key = (await create_key(client, tid))["key"]
    meta = parse_sse((await widget_chat(key, "Hello")).text)[0][1]
    cid = meta["conversation_id"]
    await client.post(f"/api/tenants/{tid}/conversations/{cid}/takeover")
    await widget_chat(key, "Waiting for you", conversation_id=cid, conversation_token=meta["conversation_token"])

    counts = (await client.get(f"/api/tenants/{tid}/inbox/counts")).json()
    assert counts == {"needs_human": 1, "unread": 1}
    rows = (await client.get(f"/api/tenants/{tid}/conversations?unread=true")).json()
    assert [r["id"] for r in rows] == [cid] and rows[0]["last_message"]["preview"] == "Waiting for you"

    assert (await client.post(f"/api/tenants/{tid}/conversations/{cid}/seen")).status_code == 204
    assert (await client.get(f"/api/tenants/{tid}/inbox/counts")).json() == {"needs_human": 1, "unread": 0}


async def test_inbox_filters_and_search(client, fake_llm):
    tid = await setup_biz(client)
    a = await convo_of(await chat(client, tid, "Do you offer teeth whitening?"))
    key = (await create_key(client, tid))["key"]
    parse_sse((await widget_chat(key, "Bonjour, êtes-vous ouverts samedi ?")).text)
    await client.post(f"/api/tenants/{tid}/conversations/{a}/takeover")

    get = lambda qs: client.get(f"/api/tenants/{tid}/conversations?{qs}")  # noqa: E731
    assert len((await get("")).json()) == 2
    assert [c["id"] for c in (await get("status=handoff")).json()] == [a]
    widget = (await get("channel=widget")).json()
    assert len(widget) == 1 and widget[0]["language"] == "fr"
    assert [c["id"] for c in (await get("q=WHITENING")).json()] == [a]
    assert (await get("q=%25")).json() == []  # "%" is searched literally, not as a wildcard
    assert (await get("status=bogus")).status_code == 422


async def test_inbox_is_private_per_business(client, fake_llm):
    tid = await setup_biz(client)
    cid = await convo_of(await chat(client, tid, "Hi"))
    async with new_client() as other:
        await login_as(other, "stranger@example.com")
        for method, path in [("post", "takeover"), ("post", "release"), ("post", "seen"), ("get", "messages")]:
            res = await getattr(other, method)(f"/api/tenants/{tid}/conversations/{cid}/{path}")
            assert res.status_code == 404, path
        res = await other.post(f"/api/tenants/{tid}/conversations/{cid}/reply", json={"text": "hi"})
        assert res.status_code == 404
        # Their own business can't reach my conversation either.
        own = (await other.post("/api/tenants", json={"name": "Other"})).json()["id"]
        assert (await other.post(f"/api/tenants/{own}/conversations/{cid}/takeover")).status_code == 404


# ---------------------------------------------------------------- team & invitations


async def invite(c, tid, email, role="member"):
    res = await c.post(f"/api/tenants/{tid}/invitations", json={"email": email, "role": role})
    assert res.status_code == 201, res.text
    return res.json()["token"]


async def test_invitation_flow(client, anon_client):
    tid = (await client.post("/api/tenants", json={"name": "Lale Clinic"})).json()["id"]
    token = await invite(client, tid, "Nurse@Example.com")

    preview = (await anon_client.get(f"/api/invitations/{token}")).json()
    assert preview == {**preview, "business": "Lale Clinic", "role": "member", "email": "nurse@example.com",
                       "invited_by": "Owner"}
    assert (await anon_client.post(f"/api/invitations/{token}/accept")).status_code == 401

    async with new_client() as wrong:
        await login_as(wrong, "someone.else@example.com")
        res = await wrong.post(f"/api/invitations/{token}/accept")
        assert res.status_code == 403 and "nurse@example.com" in res.json()["detail"]

    async with new_client() as nurse:
        await login_as(nurse, "nurse@example.com", "Nurse Joy")
        res = await nurse.post(f"/api/invitations/{token}/accept")
        assert res.status_code == 200 and res.json()["tenant_id"] == tid
        me = (await nurse.get("/api/auth/me")).json()
        assert me["tenants"] == [{"id": tid, "name": "Lale Clinic", "role": "member"}]
        assert (await nurse.post(f"/api/invitations/{token}/accept")).status_code == 404  # single use
        # members can't invite or see invitations
        assert (await nurse.post(f"/api/tenants/{tid}/invitations", json={"email": "x@example.com"})).status_code == 403
        assert (await nurse.get(f"/api/tenants/{tid}/invitations")).status_code == 403

    members = (await client.get(f"/api/tenants/{tid}/members")).json()
    assert {(m["email"], m["role"]) for m in members} == {("owner@example.com", "owner"), ("nurse@example.com", "member")}
    assert (await client.get(f"/api/tenants/{tid}/invitations")).json() == []  # accepted ones aren't pending
    assert (await client.post(f"/api/tenants/{tid}/invitations", json={"email": "nurse@example.com"})).status_code == 409


async def test_invitations_expire_are_revocable_and_replaced(client, anon_client):
    tid = (await client.post("/api/tenants", json={"name": "Biz"})).json()["id"]
    first = await invite(client, tid, "a@example.com")
    second = await invite(client, tid, "a@example.com")  # replaces the first link
    assert (await anon_client.get(f"/api/invitations/{first}")).status_code == 404
    assert (await anon_client.get(f"/api/invitations/{second}")).status_code == 200

    pending = (await client.get(f"/api/tenants/{tid}/invitations")).json()
    assert len(pending) == 1 and "token" not in pending[0]
    assert (await client.delete(f"/api/tenants/{tid}/invitations/{pending[0]['id']}")).status_code == 204
    assert (await anon_client.get(f"/api/invitations/{second}")).status_code == 404

    third = await invite(client, tid, "b@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Invitation).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await db.commit()
    assert (await anon_client.get(f"/api/invitations/{third}")).status_code == 404
    assert (await client.post(f"/api/tenants/{tid}/invitations", json={"email": "c@example.com", "role": "owner"})).status_code == 422


async def test_role_rules(client):
    tid = (await client.post("/api/tenants", json={"name": "Biz"})).json()["id"]
    owner_id = (await client.get("/api/auth/me")).json()["id"]
    async with new_client() as admin, new_client() as member:
        admin_me = await login_as(admin, "admin@example.com", "Admin")
        member_me = await login_as(member, "member@example.com", "Member")
        await admin.post(f"/api/invitations/{await invite(client, tid, 'admin@example.com', 'admin')}/accept")
        await member.post(f"/api/invitations/{await invite(client, tid, 'member@example.com')}/accept")

        url = lambda uid: f"/api/tenants/{tid}/members/{uid}"  # noqa: E731
        # admins manage members, but not owners
        assert (await admin.patch(url(member_me["id"]), json={"role": "admin"})).status_code == 200
        assert (await admin.patch(url(member_me["id"]), json={"role": "member"})).status_code == 200
        assert (await admin.patch(url(member_me["id"]), json={"role": "owner"})).status_code == 403
        assert (await admin.patch(url(owner_id), json={"role": "member"})).status_code == 403
        assert (await admin.delete(url(owner_id))).status_code == 403
        # members manage nobody
        assert (await member.patch(url(admin_me["id"]), json={"role": "member"})).status_code == 403
        # the last owner can't be demoted or removed
        assert (await client.patch(url(owner_id), json={"role": "admin"})).status_code == 409
        assert (await client.delete(url(owner_id))).status_code == 409
        # ...but can hand over ownership first
        assert (await client.patch(url(admin_me["id"]), json={"role": "owner"})).status_code == 200
        assert (await client.patch(url(owner_id), json={"role": "admin"})).status_code == 200
        # anyone can leave
        assert (await member.delete(url(member_me["id"]))).status_code == 204
        assert (await member.get(f"/api/tenants/{tid}/members")).status_code == 404


# ---------------------------------------------------------------- account


async def test_change_password_signs_out_other_browsers(client):
    async with new_client() as laptop:
        await login_as(laptop, "owner@example.com")
        sessions = (await client.get("/api/auth/sessions")).json()
        assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1

        bad = await client.post("/api/auth/password", json={"current_password": "wrong-password-1", "new_password": "a-brand-new-pass-42"})
        assert bad.status_code == 400
        weak = await client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "aaaaaaaaaaaa"})
        assert weak.status_code == 422
        ok = await client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "a-brand-new-pass-42"})
        assert ok.status_code == 204

        assert (await laptop.get("/api/auth/me")).status_code == 401  # signed out
        assert (await client.get("/api/auth/me")).status_code == 200  # this browser stays in
    async with new_client() as c:
        assert (await c.post("/api/auth/login", json={"email": "owner@example.com", "password": PASSWORD})).status_code == 401
        assert (await c.post("/api/auth/login", json={"email": "owner@example.com", "password": "a-brand-new-pass-42"})).status_code == 200


async def test_sessions_and_profile(client):
    async with new_client() as phone:
        await login_as(phone, "owner@example.com")
        assert (await client.post("/api/auth/sessions/revoke-others")).status_code == 204
        assert (await phone.get("/api/auth/me")).status_code == 401
    assert len((await client.get("/api/auth/sessions")).json()) == 1
    me = (await client.patch("/api/auth/me", json={"name": "  Ayşe Yılmaz "})).json()
    assert me["name"] == "Ayşe Yılmaz"
    assert (await client.patch("/api/auth/me", json={"name": ""})).status_code == 422


# ---------------------------------------------------------------- business settings


async def test_rename_and_delete_business(client):
    tid = (await client.post("/api/tenants", json={"name": "Old Name"})).json()["id"]
    async with new_client() as admin:
        await login_as(admin, "admin@example.com")
        await admin.post(f"/api/invitations/{await invite(client, tid, 'admin@example.com', 'admin')}/accept")
        res = await admin.patch(f"/api/tenants/{tid}", json={"name": "Lale Clinic", "default_language": "tr"})
        assert res.status_code == 200 and res.json()["name"] == "Lale Clinic" and res.json()["default_language"] == "tr"
        assert (await admin.post(f"/api/tenants/{tid}/delete", json={"confirm_name": "Lale Clinic"})).status_code == 403
    assert (await client.patch(f"/api/tenants/{tid}", json={"default_language": "xx"})).status_code == 422
    assert (await client.post(f"/api/tenants/{tid}/delete", json={"confirm_name": "lale clinic"})).status_code == 400
    assert (await client.post(f"/api/tenants/{tid}/delete", json={"confirm_name": "Lale Clinic"})).status_code == 204
    assert (await client.get(f"/api/tenants/{tid}")).status_code == 404
    assert (await client.get("/api/tenants")).json() == []


# ---------------------------------------------------------------- overview


async def test_overview_checklist_and_today(client, fake_llm):
    tid = (await client.post("/api/tenants", json={"name": "Fresh"})).json()["id"]
    o = (await client.get(f"/api/tenants/{tid}/overview")).json()
    assert not any(v for k, v in o["setup"].items() if k not in ("documents_ready", "documents_total"))
    assert o["today"] == {"conversations": 0, "answers": 0, "bookings": 0, "needs_human": 0} and o["recent"] == []

    tid = await setup_biz(client)
    await chat(client, tid, "Are you open on Saturday?")
    key = (await create_key(client, tid))["key"]
    await widget_chat(key, "Hello")
    o = (await client.get(f"/api/tenants/{tid}/overview")).json()
    s = o["setup"]
    assert s["documents"] and s["tested"] and s["widget_key"] and s["widget_live"] and not s["team"]
    assert o["today"]["answers"] == 2 and o["today"]["conversations"] == 2
    assert len(o["recent"]) == 2 and o["recent"][0]["channel"] == "widget"
    async with new_client() as other:
        await login_as(other, "x@example.com")
        assert (await other.get(f"/api/tenants/{tid}/overview")).status_code == 404


async def test_contact_is_picked_up_and_previews_are_clean(client, fake_llm):
    from app.services.agent.runner import find_contact

    assert find_contact("my mail is Deniz.K@example.com thanks") == "Deniz.K@example.com"
    assert find_contact("call me on +90 532 111 22 33") == "+90 532 111 22 33"
    assert find_contact("order 12345 please") is None

    tid = await setup_biz(client)
    cid = await convo_of(await chat(client, tid, "Are you open on Saturday? I'm deniz@example.com"))
    c = (await client.get(f"/api/tenants/{tid}/conversations/{cid}")).json()
    assert c["customer_contact"] == "deniz@example.com"
    assert c["last_message"]["role"] == "assistant" and "[1]" not in c["last_message"]["preview"]
    assert c["last_message"]["preview"] == "Yes, we are open on Saturday."
