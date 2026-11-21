"""Run one customer turn through the agent and stream events.

Events: meta -> (token | tool)* -> done, or error.
"""

import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from zoneinfo import ZoneInfo

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AgentError, Conversation, Message, Tenant
from app.services.agent.graph import MAX_STEPS, build_agent
from app.services.agent.model import ModelConfigError, get_chat_model
from app.services.agent.prompts import build_system_prompt
from app.services.agent.sources import SourceRegistry
from app.services.agent.tools import ToolContext, build_tools
from app.services.business import load_settings
from app.services.language import detect_language
from app.services import notify, tracing
from app.services.tracing import EMAIL, PHONE
from app.services.pricing import estimate_cost
from app.services.search import search_chunks

log = logging.getLogger(__name__)


def _ev(event: str, data: dict) -> dict:
    return {"event": event, "data": data}


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # some providers return content blocks
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


def find_contact(text: str) -> str | None:
    """An email address or phone number the customer wrote, if any."""
    m = EMAIL.search(text) or PHONE.search(text)
    return m.group(0).strip()[:200] if m else None


def _retrieval_query(history: list[Message], question: str) -> str:
    """Follow-ups like "and on Sunday?" need the previous question for context."""
    prev_user = next((m.content for m in reversed(history) if m.role == "user"), None)
    return f"{prev_user}\n{question}" if prev_user and len(question) < 80 else question


def _error_kind(exc: Exception) -> str:
    name = type(exc).__name__
    if "RateLimit" in name:
        return "rate_limit"
    if "Connection" in name or "Timeout" in name:
        return "connection"
    if isinstance(exc, ModelConfigError):
        return "config"
    return "other"


def _friendly_error(exc: Exception) -> str:
    kind = _error_kind(exc)
    if kind == "rate_limit":
        return "The free AI quota is used up for now. Please try again in a minute."
    if kind == "connection":
        return "Could not reach the AI provider. Check your internet connection."
    if kind == "config":
        return str(exc)
    return "Sorry, something went wrong while answering. Please try again."


async def run_turn(
    db: AsyncSession, tenant: Tenant, question: str, conversation_id: uuid.UUID | None, channel: str = "playground",
    language_hint: str | None = None, external_id: str | None = None,
) -> AsyncIterator[dict]:
    """`language_hint` (e.g. the widget's UI language) is only used when the text itself is unclear.
    `external_id` is the channel's id for the customer's message (WhatsApp), stored to make delivery idempotent."""
    cfg = get_settings()
    started = time.perf_counter()
    biz = load_settings(tenant.settings)

    # --- conversation (always scoped to this tenant) ---
    convo = None
    if conversation_id:
        convo = await db.get(Conversation, conversation_id)
        if convo is None or convo.tenant_id != tenant.id:
            yield _ev("error", {"message": "Conversation not found."})
            return
    if convo is None:
        convo = Conversation(tenant_id=tenant.id, channel=channel, title=question[:200])
        db.add(convo)
        await db.flush()

    history = list(
        (
            await db.scalars(
                select(Message)
                .where(Message.conversation_id == convo.id)
                .order_by(Message.created_at.desc())
                .limit(cfg.history_messages)
            )
        ).all()
    )[::-1]

    prev_lang = next((m.language for m in reversed(history) if m.role == "user" and m.language), None)
    language = detect_language(question, fallback=prev_lang or language_hint)
    user_msg = Message(tenant_id=tenant.id, conversation_id=convo.id, role="user", content=question, language=language,
                       external_id=external_id)
    db.add(user_msg)
    convo.last_message_at = datetime.now(ZoneInfo("UTC"))
    if convo.status == "resolved":
        convo.status = "open"  # the customer came back: it needs attention again
    if not convo.customer_contact:
        convo.customer_contact = find_contact(question)  # so the team knows who they're talking to
    was_handoff = convo.status == "handoff"
    await db.commit()

    if convo.ai_paused:
        # A team member has taken over: save the message for them, the agent stays silent.
        yield _ev("meta", {"conversation_id": str(convo.id), "language": language, "sources": []})
        yield _ev("done", {
            "message_id": None, "conversation_id": str(convo.id), "conversation_status": convo.status,
            "ai_paused": True, "cited": [], "tool_calls": [], "model": None, "prompt_tokens": 0,
            "completion_tokens": 0, "latency_ms": 0, "first_token_ms": None, "cost_usd": None, "trace_id": None,
        })
        return

    # --- retrieval up front (fast, deterministic); the agent can search again via a tool ---
    registry = SourceRegistry()
    hits = await search_chunks(db, tenant.id, _retrieval_query(history, question), cfg.retrieval_k)
    initial = registry.add([h for h in hits if h.score >= cfg.min_relevance])
    yield _ev("meta", {"conversation_id": str(convo.id), "language": language,
                       "sources": [s.to_dict() for s in initial]})

    now_local = datetime.now(ZoneInfo(biz.timezone))
    phone = f"+{convo.external_user}" if convo.channel == "whatsapp" and convo.external_user else None
    messages = [SystemMessage(build_system_prompt(tenant.name, biz, now_local, language, initial,
                                                  channel=convo.channel, customer_phone=phone))]
    messages += [HumanMessage(m.content) if m.role == "user" else AIMessage(m.content) for m in history]
    messages.append(HumanMessage(question))

    ctx = ToolContext(tenant_id=tenant.id, conversation_id=convo.id, turn_id=str(user_msg.id), settings=biz,
                      registry=registry)

    parts: list[str] = []
    tool_calls: dict[str, dict] = {}  # id -> {name, args, status, result}
    prompt_tokens = completion_tokens = 0
    first_token_ms: int | None = None
    last_step = None
    model_name = cfg.chat_model

    trace_cfg, trace_id = tracing.turn_config(
        seed=str(user_msg.id), tenant_id=str(tenant.id), tenant_name=tenant.name,
        conversation_id=str(convo.id), channel=convo.channel, language=language,
    )
    run_config = {"recursion_limit": MAX_STEPS} | trace_cfg

    try:
        model = get_chat_model()
        model_name = getattr(model, "model_name", None) or getattr(model, "model", None) or model_name
        agent = build_agent(model, build_tools(ctx))
        stream = agent.astream(
            {"messages": messages},
            config=run_config,
            stream_mode=["messages", "updates"],
        )
        async for mode, payload in stream:
            if mode == "messages":
                chunk, meta = payload
                if meta.get("langgraph_node") != "agent":
                    continue  # raw tool output is not for the customer
                text = _text_of(chunk.content)
                if not text:
                    continue
                step = meta.get("langgraph_step")
                if last_step is not None and step != last_step and parts and not parts[-1].endswith("\n"):
                    parts.append("\n\n")  # new agent turn after a tool call
                    yield _ev("token", {"text": "\n\n"})
                last_step = step
                text = text.replace("【", "[").replace("】", "]")
                if first_token_ms is None:
                    first_token_ms = int((time.perf_counter() - started) * 1000)
                parts.append(text)
                yield _ev("token", {"text": text})
                continue

            for node, update in payload.items():
                for m in (update or {}).get("messages", []):
                    if node == "agent" and isinstance(m, AIMessage):
                        usage = m.usage_metadata or {}
                        prompt_tokens += usage.get("input_tokens", 0)
                        completion_tokens += usage.get("output_tokens", 0)
                        for tc in m.tool_calls:
                            tool_calls[tc["id"]] = {"id": tc["id"], "name": tc["name"], "args": tc["args"],
                                                    "status": "running", "result": None}
                            yield _ev("tool", tool_calls[tc["id"]])
                    elif node == "tools" and isinstance(m, ToolMessage):
                        rec = tool_calls.get(m.tool_call_id) or {"id": m.tool_call_id, "name": m.name, "args": {}}
                        artifact = m.artifact if isinstance(m.artifact, dict) else None
                        failed = m.status == "error" or bool(artifact and artifact.get("error"))
                        rec.update(status="error" if failed else "done",
                                   result=artifact or {"error": _text_of(m.content)[:300]})
                        tool_calls[rec["id"]] = rec
                        yield _ev("tool", rec)
    except Exception as exc:  # provider errors, recursion limit, etc.
        log.exception("Agent turn failed")
        db.add(AgentError(tenant_id=tenant.id, conversation_id=convo.id, kind=_error_kind(exc),
                          detail=f"{type(exc).__name__}: {exc}"[:500]))
        await db.commit()
        yield _ev("error", {"message": _friendly_error(exc)})
        return

    answer = "".join(parts).strip()
    cited = [s.to_dict() for s in registry.cited_in(answer)]
    latency_ms = int((time.perf_counter() - started) * 1000)
    calls = list(tool_calls.values())

    msg = Message(
        tenant_id=tenant.id, conversation_id=convo.id, role="assistant", content=answer, language=language,
        sources=cited, tool_calls=calls or None, model=str(model_name), prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens, latency_ms=latency_ms, first_token_ms=first_token_ms,
        cost_usd=estimate_cost(str(model_name), prompt_tokens, completion_tokens), trace_id=trace_id,
    )
    db.add(msg)
    convo.last_message_at = datetime.now(ZoneInfo("UTC"))
    await db.commit()
    await db.refresh(convo)

    yield _ev("done", {
        "message_id": str(msg.id), "conversation_id": str(convo.id), "conversation_status": convo.status,
        "ai_paused": convo.ai_paused,
        "cited": cited, "tool_calls": calls, "model": str(model_name),
        "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
        "latency_ms": latency_ms, "first_token_ms": first_token_ms,
        "cost_usd": float(msg.cost_usd) if msg.cost_usd is not None else None, "trace_id": trace_id,
    })

    # After the customer has their answer: email the team if this turn handed the chat to a human.
    if convo.status == "handoff" and not was_handoff:
        try:
            await notify.handoff(tenant.id, convo.id)
        except Exception:
            log.exception("Hand-off alert failed")
