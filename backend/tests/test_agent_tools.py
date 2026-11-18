"""Agent tools end-to-end through the chat API, plus the booking rules directly."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.db.session import SessionLocal
from app.services.booking import BookingError, available_slots, book
from app.services.business import load_settings
from tests.test_chat import answer_text, chat, setup_biz

TZ = ZoneInfo("Europe/Istanbul")


def next_weekday(weekday: int) -> date:
    """Next date (at least 2 days ahead) falling on weekday (0=Mon)."""
    d = date.today() + timedelta(days=2)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


def tools_in(events):
    return [d for e, d in events if e == "tool"]


async def test_check_availability_then_answer(client, fake_llm):
    tid = await setup_biz(client)
    friday = next_weekday(4).isoformat()
    fake_llm.script = [[("check_availability", {"date": friday})], "Free times: 09:00, 09:30."]

    events = await chat(client, tid, "Any free time on Friday?")
    tool_events = tools_in(events)
    assert [t["status"] for t in tool_events] == ["running", "done"]
    result = tool_events[-1]["result"]
    assert result["weekday"] == "Friday" and result["slots"][0] == "09:00"
    assert result["slots"][-1] == "17:30"  # default hours 09:00-18:00, 30 min slots

    # The model saw the tool result before writing its answer.
    assert any(m.type == "tool" and "09:00" in m.content for m in fake_llm.calls[1])
    assert "Free times" in answer_text(events)
    assert fake_llm.tools == ["search_knowledge", "check_availability", "book_appointment",
                              "get_order_status", "handoff_to_human"]


async def book_two_step(client, fake_llm, tid, args, convo=None):
    """Propose (turn 1), then confirm with the same details (turn 2). Returns (tool event, conversation id)."""
    fake_llm.script = [[("book_appointment", args)], "Please confirm."]
    events = await chat(client, tid, "Book it", convo)
    proposal = tools_in(events)[-1]
    assert proposal["result"].get("pending") is True, proposal
    convo = events[-1][1]["conversation_id"]
    fake_llm.script = [[("book_appointment", args)], "Booked!"]
    return tools_in(await chat(client, tid, "Yes, confirm", convo))[-1], convo


async def test_booking_needs_confirmation_in_a_later_turn(client, fake_llm):
    tid = await setup_biz(client)
    day = next_weekday(1).isoformat()  # Tuesday
    args = {"customer_name": "Ayşe Yılmaz", "customer_contact": "+90 532 000 0000", "date": day, "time": "10:00"}

    # The model proposing AND "confirming" within one turn must not book anything.
    fake_llm.script = [[("book_appointment", args)], [("book_appointment", args)], "Done?"]
    events = await chat(client, tid, "Book me Tuesday 10:00")
    assert all(t["result"].get("pending") for t in tools_in(events) if t["status"] == "done")
    assert (await client.get(f"/api/tenants/{tid}/appointments")).json() == []

    # Customer replies -> same details -> booked. Formatting differences don't matter.
    convo = events[-1][1]["conversation_id"]
    fake_llm.script = [[("book_appointment", args | {"customer_contact": "+905320000000", "customer_name": "ayşe  yılmaz"})], "Booked!"]
    booked = tools_in(await chat(client, tid, "Evet", convo))[-1]
    assert booked["status"] == "done" and booked["result"]["code"].startswith("RB-")
    assert booked["result"]["time"] == "10:00" and not booked["result"].get("pending")

    appts = (await client.get(f"/api/tenants/{tid}/appointments")).json()
    assert len(appts) == 1 and appts[0]["customer_name"] == "ayşe  yılmaz"

    # Calling again in the same conversation returns the same code (no duplicate).
    fake_llm.script = [[("book_appointment", args)], "Already booked."]
    again = tools_in(await chat(client, tid, "Did it work?", convo))[-1]
    assert again["result"]["code"] == booked["result"]["code"]
    assert len((await client.get(f"/api/tenants/{tid}/appointments")).json()) == 1


async def test_changed_details_need_a_new_confirmation(client, fake_llm):
    tid = await setup_biz(client)
    day = next_weekday(3).isoformat()
    args = {"customer_name": "Can", "customer_contact": "can@x.com", "date": day, "time": "10:00"}
    fake_llm.script = [[("book_appointment", args)], "Confirm?"]
    convo = (await chat(client, tid, "Book"))[-1][1]["conversation_id"]
    fake_llm.script = [[("book_appointment", args | {"time": "10:30"})], "Confirm the new time?"]
    changed = tools_in(await chat(client, tid, "Make it 10:30", convo))[-1]
    assert changed["result"]["pending"] is True and changed["result"]["time"] == "10:30"


async def test_slot_taken_by_someone_else_is_refused(client, fake_llm):
    tid = await setup_biz(client)
    day = next_weekday(1).isoformat()
    args = {"customer_name": "First", "customer_contact": "a@b.com", "date": day, "time": "10:00"}
    booked, _ = await book_two_step(client, fake_llm, tid, args)
    assert booked["status"] == "done"

    fake_llm.script = [[("book_appointment", args | {"customer_name": "Second"})], "Sorry."]
    second = tools_in(await chat(client, tid, "Book 10:00 too"))[-1]
    assert second["status"] == "error" and "not available" in second["result"]["error"]

    fake_llm.script = [[("check_availability", {"date": day})], "ok"]
    slots = tools_in(await chat(client, tid, "What's free?"))[-1]["result"]["slots"]
    assert "10:00" not in slots and "09:30" in slots


async def test_cancelled_slot_becomes_free_again(client, fake_llm):
    tid = await setup_biz(client)
    day = next_weekday(2).isoformat()
    args = {"customer_name": "A B", "customer_contact": "a@b.com", "date": day, "time": "11:00"}
    await book_two_step(client, fake_llm, tid, args)
    appt = (await client.get(f"/api/tenants/{tid}/appointments")).json()[0]
    assert (await client.post(f"/api/tenants/{tid}/appointments/{appt['id']}/cancel")).json()["status"] == "cancelled"

    booked, _ = await book_two_step(client, fake_llm, tid, args)
    assert booked["status"] == "done" and booked["result"]["code"]


async def test_order_lookup_requires_matching_contact(client, fake_llm):
    tid = await setup_biz(client)
    assert (await client.post(f"/api/tenants/{tid}/orders/demo")).status_code == 204

    fake_llm.script = [[("get_order_status", {"order_number": "#48213", "email_or_phone": "AYSE@example.com"})], "ok"]
    found = tools_in(await chat(client, tid, "Where is order 48213?"))[-1]
    assert found["status"] == "done" and found["result"]["status"] == "shipped"
    assert found["result"]["tracking_number"] == "YK-99120"

    fake_llm.script = [[("get_order_status", {"order_number": "48213", "email_or_phone": "0532 111 2233"})], "ok"]
    assert tools_in(await chat(client, tid, "by phone"))[-1]["status"] == "done"

    fake_llm.script = [[("get_order_status", {"order_number": "48213", "email_or_phone": "stranger@evil.com"})], "ok"]
    denied = tools_in(await chat(client, tid, "Where is order 48213?"))[-1]
    assert denied["status"] == "error" and "status" not in denied["result"]  # nothing leaked


async def test_orders_are_isolated_between_businesses(client, fake_llm):
    a = await setup_biz(client, "Shop A")
    b = await setup_biz(client, "Shop B")
    await client.post(f"/api/tenants/{a}/orders/demo")
    fake_llm.script = [[("get_order_status", {"order_number": "48213", "email_or_phone": "ayse@example.com"})], "ok"]
    assert tools_in(await chat(client, b, "Where is order 48213?"))[-1]["status"] == "error"
    assert (await client.get(f"/api/tenants/{b}/orders")).json() == []


async def test_handoff_flags_conversation(client, fake_llm):
    tid = await setup_biz(client)
    fake_llm.script = [
        [("handoff_to_human", {"reason": "Wants a refund", "customer_contact": "+90 555 000 1111"})],
        "A team member will contact you.",
    ]
    done = (await chat(client, tid, "I want to talk to a person"))[-1][1]
    assert done["conversation_status"] == "handoff"

    handoffs = (await client.get(f"/api/tenants/{tid}/conversations?status=handoff")).json()
    assert handoffs[0]["handoff_reason"] == "Wants a refund"
    assert handoffs[0]["customer_contact"] == "+90 555 000 1111"

    assert (await client.post(f"/api/tenants/{tid}/conversations/{done['conversation_id']}/resolve")).status_code == 204
    assert (await client.get(f"/api/tenants/{tid}/conversations?status=handoff")).json() == []


async def test_disabled_tools_are_not_offered(client, fake_llm):
    tid = await setup_biz(client)
    s = (await client.get(f"/api/tenants/{tid}/settings")).json()
    s["tools"] = {"booking": False, "orders": False, "handoff": True}
    assert (await client.put(f"/api/tenants/{tid}/settings", json=s)).status_code == 200

    await chat(client, tid, "Can I book?")
    assert fake_llm.tools == ["search_knowledge", "handoff_to_human"]
    assert "You cannot book appointments" in fake_llm.calls[0][0].content


async def test_settings_validation(client):
    tid = (await client.post("/api/tenants", json={"name": "Biz"})).json()["id"]
    s = (await client.get(f"/api/tenants/{tid}/settings")).json()
    assert s["booking"]["hours"]["sun"] is None
    bad = s | {"booking": s["booking"] | {"hours": {"mon": "18:00-09:00"}}}
    assert (await client.put(f"/api/tenants/{tid}/settings", json=bad)).status_code == 422
    assert (await client.put(f"/api/tenants/{tid}/settings", json=s | {"timezone": "Mars/Base"})).status_code == 422


async def test_search_knowledge_tool_adds_numbered_sources(client, fake_llm):
    tid = await setup_biz(client)
    await client.post(f"/api/tenants/{tid}/documents/text",
                      json={"title": "Parking", "text": "Free parking is behind the building."})
    fake_llm.script = [[("search_knowledge", {"query": "free parking building"})], "Free parking behind [2]."]
    events = await chat(client, tid, "hours on Saturday?")  # initial retrieval finds only hours
    done = events[-1][1]
    assert [s["document_title"] for s in done["cited"]] == ["Parking"]


# ---------- booking rules directly ----------


@pytest.fixture
def biz_settings():
    return load_settings({"booking": {"services": [{"name": "Teeth whitening", "minutes": 60},
                                                    {"name": "Consultation", "minutes": 30}]}})


async def test_closed_day_and_past_dates(biz_settings):
    import uuid

    async with SessionLocal() as db:
        with pytest.raises(BookingError, match="closed"):
            await available_slots(db, uuid.uuid4(), biz_settings, next_weekday(6))  # Sunday
        with pytest.raises(BookingError, match="past"):
            await available_slots(db, uuid.uuid4(), biz_settings, date.today() - timedelta(days=1))


async def test_long_service_blocks_overlaps(client, biz_settings):
    tid = (await client.post("/api/tenants", json={"name": "Biz"})).json()["id"]
    import uuid

    t = uuid.UUID(tid)
    sat = next_weekday(5)  # Saturday 09:00-14:00
    async with SessionLocal() as db:
        svc, slots = await available_slots(db, t, biz_settings, sat, "whitening")
        assert svc.minutes == 60 and slots[-1] == "13:00"  # must finish by 14:00
        await book(db, t, biz_settings, day=sat, start_time="10:00", customer_name="X",
                   customer_contact="x@y.z", service_name="Teeth whitening")
        _, slots = await available_slots(db, t, biz_settings, sat, "Consultation")
        assert "10:00" not in slots and "10:30" not in slots and "11:00" in slots and "09:30" in slots


async def test_no_slots_within_lead_time(biz_settings):
    import uuid

    now = datetime.combine(next_weekday(0), datetime.min.time(), TZ).replace(hour=12, minute=10)
    async with SessionLocal() as db:
        _, slots = await available_slots(db, uuid.uuid4(), biz_settings, now.date(), "Consultation", now=now)
    assert slots[0] == "13:00"  # 12:30 is within 30 min of 12:10
