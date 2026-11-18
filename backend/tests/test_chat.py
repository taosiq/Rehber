"""Chat: streaming SSE, grounding, citations, history, language and tenant isolation."""

import json

from app.services.agent.sources import cited_numbers


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    events = []
    for block in raw.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        events.append((lines["event"], json.loads(lines["data"])))
    return events


async def setup_biz(client, name="Lumen Dental"):
    tid = (await client.post("/api/tenants", json={"name": name})).json()["id"]
    await client.post(
        f"/api/tenants/{tid}/documents/text",
        json={"title": "Opening hours", "text": "We are open on Saturday from 9 to 14. Closed on Sunday."},
    )
    return tid


async def chat(client, tid, message, conversation_id=None):
    body = {"message": message, "conversation_id": conversation_id}
    res = await client.post(f"/api/tenants/{tid}/chat", json=body)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    return parse_sse(res.text)


def answer_text(events) -> str:
    return "".join(d["text"] for e, d in events if e == "token")


def system_prompt(fake_llm, call=0) -> str:
    return fake_llm.calls[call][0].content


def test_cited_numbers():
    assert cited_numbers("Open [1]. Price [2][3], also [3] and [1, 4] and 【5】.") == [1, 2, 3, 4, 5]
    assert cited_numbers("No citations here") == []


async def test_streams_answer_with_cited_sources(client, fake_llm):
    tid = await setup_biz(client)
    events = await chat(client, tid, "Are you open on Saturday?")

    kinds = [e for e, _ in events]
    assert kinds[0] == "meta" and kinds[-1] == "done"
    assert kinds.count("token") > 3  # really streamed in pieces

    assert events[0][1]["sources"][0]["document_title"] == "Opening hours"
    assert "Saturday [1]" in answer_text(events)

    done = events[-1][1]
    assert [s["n"] for s in done["cited"]] == [1]
    assert done["prompt_tokens"] == 100 and done["completion_tokens"] == 20
    assert done["first_token_ms"] is not None and done["conversation_status"] == "open"

    prompt = system_prompt(fake_llm)
    assert "Lumen Dental" in prompt and "open on Saturday" in prompt
    assert "(today)" in prompt  # calendar for date maths


async def test_uncited_and_made_up_citations_are_dropped(client, fake_llm):
    tid = await setup_biz(client)
    fake_llm.reply = "We open at 9 [1] and also see [7]."  # [7] doesn't exist
    done = (await chat(client, tid, "Are you open on Saturday?"))[-1][1]
    assert [s["n"] for s in done["cited"]] == [1]


async def test_conversation_history_is_saved_and_reused(client, fake_llm):
    tid = await setup_biz(client)
    convo_id = (await chat(client, tid, "Are you open on Saturday?"))[-1][1]["conversation_id"]
    await chat(client, tid, "And on Sunday?", convo_id)

    second_call = fake_llm.calls[1]
    assert [m.type for m in second_call[1:]] == ["human", "ai", "human"]

    msgs = (await client.get(f"/api/tenants/{tid}/conversations/{convo_id}/messages")).json()
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[1]["sources"][0]["document_title"] == "Opening hours"
    assert msgs[1]["completion_tokens"] == 20

    convos = (await client.get(f"/api/tenants/{tid}/conversations")).json()
    assert convos[0]["message_count"] == 4 and convos[0]["status"] == "open"


async def test_no_documents_means_no_sources(client, fake_llm):
    tid = (await client.post("/api/tenants", json={"name": "Empty Biz"})).json()["id"]
    fake_llm.reply = "I don't have that information."
    events = await chat(client, tid, "What are your prices?")
    assert events[0][1]["sources"] == []
    assert "No relevant information" in system_prompt(fake_llm)


async def test_llm_failure_becomes_error_event(client, fake_llm):
    tid = await setup_biz(client)
    fake_llm.fail = True
    events = await chat(client, tid, "Hello?")
    assert events[-1][0] == "error"
    assert "quota" in events[-1][1]["message"]


async def test_cannot_continue_another_tenants_conversation(client, fake_llm):
    a = await setup_biz(client, "Biz A")
    b = await setup_biz(client, "Biz B")
    convo_id = (await chat(client, a, "Open Saturday?"))[-1][1]["conversation_id"]

    events = await chat(client, b, "Show me", convo_id)
    assert events == [("error", {"message": "Conversation not found."})]
    assert (await client.get(f"/api/tenants/{b}/conversations/{convo_id}/messages")).status_code == 404
    assert (await client.get(f"/api/tenants/{b}/conversations")).json() == []


async def test_detects_language_and_tells_the_model(client, fake_llm):
    tid = await setup_biz(client)
    events = await chat(client, tid, "Cumartesi günü açık mısınız?")
    assert events[0][1]["language"] == "tr"
    assert "Reply ONLY in Turkish" in system_prompt(fake_llm)

    convo = events[-1][1]["conversation_id"]
    events = await chat(client, tid, "ok", convo)  # too short: keeps conversation language
    assert events[0][1]["language"] == "tr"


async def test_cjk_brackets_are_normalised(client, fake_llm):
    tid = await setup_biz(client)
    fake_llm.reply = "Open on Saturday 【1】."
    events = await chat(client, tid, "Are you open on Saturday?")
    assert "[1]" in answer_text(events) and "【" not in answer_text(events)
    assert [s["n"] for s in events[-1][1]["cited"]] == [1]
