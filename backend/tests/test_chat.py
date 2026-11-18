"""Chat: streaming SSE, grounding, citations, history and tenant isolation."""

import json

from app.services.rag import cited_numbers


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    events = []
    for block in raw.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        events.append((lines["event"], json.loads(lines["data"])))
    return events


async def _setup(client, name="Lumen Dental"):
    tid = (await client.post("/api/tenants", json={"name": name})).json()["id"]
    await client.post(
        f"/api/tenants/{tid}/documents/text",
        json={"title": "Opening hours", "text": "We are open on Saturday from 9 to 14. Closed on Sunday."},
    )
    return tid


async def _chat(client, tid, message, conversation_id=None):
    body = {"message": message, "conversation_id": conversation_id}
    res = await client.post(f"/api/tenants/{tid}/chat", json=body)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    return parse_sse(res.text)


def test_cited_numbers():
    assert cited_numbers("Open [1]. Price [2][3], also [3] and [1, 4].") == [1, 2, 3, 4]
    assert cited_numbers("No citations here") == []


async def test_streams_answer_with_cited_sources(client, fake_llm):
    tid = await _setup(client)
    events = await _chat(client, tid, "Are you open on Saturday?")

    kinds = [e for e, _ in events]
    assert kinds[0] == "meta" and kinds[-1] == "done"
    assert kinds.count("token") > 3  # really streamed in pieces

    meta = events[0][1]
    assert meta["sources"][0]["document_title"] == "Opening hours"
    text = "".join(d["text"] for e, d in events if e == "token")
    assert "Saturday [1]" in text

    done = events[-1][1]
    assert [s["n"] for s in done["cited"]] == [1]
    assert done["prompt_tokens"] == 100 and done["completion_tokens"] == 20
    assert done["latency_ms"] >= 0 and done["first_token_ms"] is not None

    # The model got the business name and the passage in its instructions.
    system = fake_llm.calls[0][0]["content"]
    assert "Lumen Dental" in system and "open on Saturday" in system


async def test_uncited_and_made_up_citations_are_dropped(client, fake_llm):
    tid = await _setup(client)
    fake_llm.reply = "We open at 9 [1] and also see [7]."  # [7] doesn't exist
    done = (await _chat(client, tid, "Are you open on Saturday?"))[-1][1]
    assert [s["n"] for s in done["cited"]] == [1]


async def test_conversation_history_is_saved_and_reused(client, fake_llm):
    tid = await _setup(client)
    convo_id = (await _chat(client, tid, "Are you open on Saturday?"))[-1][1]["conversation_id"]
    await _chat(client, tid, "And on Sunday?", convo_id)

    second_call = fake_llm.calls[1]
    assert [m["role"] for m in second_call[1:]] == ["user", "assistant", "user"]

    msgs = (await client.get(f"/api/tenants/{tid}/conversations/{convo_id}/messages")).json()
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[1]["sources"][0]["document_title"] == "Opening hours"
    assert msgs[1]["completion_tokens"] == 20

    convos = (await client.get(f"/api/tenants/{tid}/conversations")).json()
    assert convos[0]["message_count"] == 4


async def test_no_documents_means_no_sources(client, fake_llm):
    tid = (await client.post("/api/tenants", json={"name": "Empty Biz"})).json()["id"]
    fake_llm.reply = "I don't have that information."
    events = await _chat(client, tid, "What are your prices?")
    assert events[0][1]["sources"] == []
    assert "No relevant information" in fake_llm.calls[0][0]["content"]


async def test_llm_failure_becomes_error_event(client, fake_llm):
    tid = await _setup(client)
    fake_llm.fail = True
    events = await _chat(client, tid, "Hello?")
    assert events[-1][0] == "error"
    assert "quota" in events[-1][1]["message"]


async def test_cannot_continue_another_tenants_conversation(client, fake_llm):
    a = await _setup(client, "Biz A")
    b = await _setup(client, "Biz B")
    convo_id = (await _chat(client, a, "Open Saturday?"))[-1][1]["conversation_id"]

    events = await _chat(client, b, "Show me", convo_id)
    assert events == [("error", {"message": "Conversation not found."})]
    assert (await client.get(f"/api/tenants/{b}/conversations/{convo_id}/messages")).status_code == 404
    assert (await client.get(f"/api/tenants/{b}/conversations")).json() == []


async def test_detects_language_and_tells_the_model(client, fake_llm):
    tid = await _setup(client)
    events = await _chat(client, tid, "Cumartesi günü açık mısınız?")
    assert events[0][1]["language"] == "tr"
    assert "Reply ONLY in Turkish" in fake_llm.calls[0][0]["content"]

    # A too-short follow-up ("ok") keeps the conversation's language.
    convo = events[-1][1]["conversation_id"]
    events = await _chat(client, tid, "ok", convo)
    assert events[0][1]["language"] == "tr"


async def test_cjk_brackets_are_normalised(client, fake_llm):
    tid = await _setup(client)
    fake_llm.reply = "Open on Saturday 【1】."
    events = await _chat(client, tid, "Are you open on Saturday?")
    text = "".join(d["text"] for e, d in events if e == "token")
    assert "[1]" in text and "【" not in text
    assert [s["n"] for s in events[-1][1]["cited"]] == [1]
