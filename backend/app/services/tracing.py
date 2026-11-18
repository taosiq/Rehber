"""Optional Langfuse tracing of every agent turn.

Off unless LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set. Each turn becomes one trace:
- trace id is derived from the user message id, so the dashboard can link straight to it
- session = conversation, user = the business (Langfuse then groups cost/latency per business)
- tags: channel and language
Emails and phone numbers are masked before anything leaves the server (LANGFUSE_MASK_PII).
Tracing must never break answering: every failure here is logged and ignored.
"""

import logging
import re
from functools import lru_cache
from typing import Any

from app.core.config import get_settings

log = logging.getLogger(__name__)

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Phone-like: 7+ digits with optional spaces, dashes, dots, parentheses and a leading +.
PHONE = re.compile(r"(?<![\w(])\+?\(?\d(?:[\s\-.()]*\d){6,}(?![\w])")


def mask_pii(data: Any) -> Any:
    if isinstance(data, str):
        return PHONE.sub("[phone]", EMAIL.sub("[email]", data))
    if isinstance(data, dict):
        return {k: mask_pii(v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return type(data)(mask_pii(v) for v in data)
    return data


def enabled() -> bool:
    s = get_settings()
    return bool(s.langfuse_public_key and s.langfuse_secret_key)


@lru_cache
def client():
    from langfuse import Langfuse

    s = get_settings()
    return Langfuse(
        public_key=s.langfuse_public_key,
        secret_key=s.langfuse_secret_key,
        base_url=s.langfuse_base_url,
        environment=s.environment,
        mask=(lambda *, data, **_: mask_pii(data)) if s.langfuse_mask_pii else None,
    )


def trace_id_for(seed: str) -> str:
    from langfuse import Langfuse

    return Langfuse.create_trace_id(seed=seed)


def turn_config(*, seed: str, tenant_id: str, tenant_name: str, conversation_id: str, channel: str,
                language: str | None) -> tuple[dict, str | None]:
    """LangChain config additions for one turn, and the trace id (None when tracing is off)."""
    if not enabled():
        return {}, None
    try:
        from langfuse.langchain import CallbackHandler

        client()  # make sure the client exists with our settings (masking, environment)
        trace_id = trace_id_for(seed)
        handler = CallbackHandler(public_key=get_settings().langfuse_public_key, trace_context={"trace_id": trace_id})
        return {
            "callbacks": [handler],
            "run_name": "support-turn",
            "metadata": {
                "langfuse_session_id": conversation_id,
                "langfuse_user_id": f"business:{tenant_id}",
                "langfuse_tags": [f"channel:{channel}", f"lang:{language or 'unknown'}"],
                "business": tenant_name,
            },
        }, trace_id
    except Exception:
        log.exception("Langfuse tracing setup failed; answering without tracing")
        return {}, None


def score(trace_id: str, name: str, value: float, comment: str | None = None) -> None:
    if not enabled():
        return
    try:
        client().create_score(trace_id=trace_id, name=name, value=value, data_type="NUMERIC", comment=comment)
    except Exception:
        log.exception("Langfuse score failed")


def trace_url(trace_id: str) -> str | None:
    if not enabled():
        return None
    try:
        return client().get_trace_url(trace_id=trace_id)
    except Exception:
        return None


def flush() -> None:
    if enabled():
        try:
            client().flush()
        except Exception:
            log.exception("Langfuse flush failed")
