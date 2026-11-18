"""The chat model behind the agent (swappable; tests use a fake)."""

from langchain_core.language_models import BaseChatModel

from app.core.config import get_settings


class ModelConfigError(Exception):
    pass


_model: BaseChatModel | None = None


def get_chat_model() -> BaseChatModel:
    global _model
    if _model is None:
        s = get_settings()
        if s.llm_provider != "groq":
            raise ModelConfigError(f"LLM provider '{s.llm_provider}' is not set up yet.")
        if not s.groq_api_key:
            raise ModelConfigError("No GROQ_API_KEY set in backend/.env")
        from langchain_groq import ChatGroq

        _model = ChatGroq(
            model=s.chat_model,
            api_key=s.groq_api_key,
            temperature=0.2,
            max_tokens=2048,
            max_retries=2,
            timeout=60,
            # gpt-oss thinks before answering: keep it brief and hidden for fast replies.
            reasoning_effort="low",
            reasoning_format="hidden",
        )
    return _model


def set_chat_model(model: BaseChatModel | None) -> None:
    """Swap the model (used by tests)."""
    global _model
    _model = model
