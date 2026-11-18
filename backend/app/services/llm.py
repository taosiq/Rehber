"""Chat model connector.

A tiny interface (`stream`) so the provider can be swapped (Groq today,
Claude or others later) without touching the RAG logic.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

from app.core.config import get_settings


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class StreamResult:
    """Filled in while streaming; read after the stream ends."""

    model: str = ""
    usage: Usage = field(default_factory=Usage)


class ChatLLM(Protocol):
    model: str

    def stream(self, messages: list[dict], result: StreamResult) -> AsyncIterator[str]:
        """Yield text pieces as they're generated; fill `result` at the end."""
        ...


class LLMError(Exception):
    """Provider failure, with a message safe to show users."""


class GroqLLM:
    def __init__(self, api_key: str, model: str):
        from groq import AsyncGroq

        if not api_key:
            raise LLMError("No GROQ_API_KEY set in backend/.env")
        self.client = AsyncGroq(api_key=api_key, max_retries=2, timeout=60)
        self.model = model

    async def stream(self, messages: list[dict], result: StreamResult) -> AsyncIterator[str]:
        import groq

        result.model = self.model
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True,
                temperature=0.2,
                max_completion_tokens=2048,
                # gpt-oss thinks before answering; keep it brief and hidden for fast replies.
                reasoning_effort="low",
                include_reasoning=False,
            )
            async for chunk in stream:
                if chunk.usage:
                    result.usage = Usage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens)
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except groq.RateLimitError as exc:
            raise LLMError("The free AI quota is used up for now. Please try again in a minute.") from exc
        except groq.APIConnectionError as exc:
            raise LLMError("Could not reach the AI provider. Check your internet connection.") from exc
        except groq.APIStatusError as exc:
            raise LLMError(f"The AI provider returned an error ({exc.status_code}).") from exc


_llm: ChatLLM | None = None


def get_llm() -> ChatLLM:
    global _llm
    if _llm is None:
        s = get_settings()
        if s.llm_provider != "groq":
            raise LLMError(f"LLM provider '{s.llm_provider}' is not set up yet.")
        _llm = GroqLLM(s.groq_api_key, s.chat_model)
    return _llm


def set_llm(llm: ChatLLM | None) -> None:
    """Swap the model (used by tests)."""
    global _llm
    _llm = llm
