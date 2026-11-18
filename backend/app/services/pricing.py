"""Estimated cost of an answer at the provider's list price."""

from decimal import Decimal

from app.core.config import get_settings


def estimate_cost(model: str | None, prompt_tokens: int, completion_tokens: int) -> Decimal | None:
    """USD cost, or None when we don't know the model's price."""
    price = get_settings().model_prices.get(model or "")
    if price is None:
        return None
    per_in, per_out = (Decimal(str(p)) for p in price)
    return (prompt_tokens * per_in + completion_tokens * per_out) / Decimal(1_000_000)
