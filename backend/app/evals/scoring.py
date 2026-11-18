"""Deterministic checks for one evaluation case.

Each check returns (name, passed, detail). A case passes when every check passes.
Text checks run on a normalized answer: case-folded, Arabic/Persian digits turned into 0-9 and
thousands separators removed ("1.500", "1,500", "١٬٥٠٠" -> "1500"), so they work in all 8 languages.
"""

import re
from dataclasses import dataclass, field

from app.services.language import detect_language

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_THOUSANDS = re.compile(r"(?<=\d)[.,\s٬  ](?=\d{3}(?!\d))")
_CURRENCY = r"(?:try|tl|₺|lira|liras|usd|\$|eur|€|ترک|لیر|ليرة|روپے|лир|руб)"
_PRICE = re.compile(rf"(\d+(?:[.,]\d+)?)\s*{_CURRENCY}|{_CURRENCY}\s*(\d+(?:[.,]\d+)?)", re.IGNORECASE)


def normalize(text: str) -> str:
    t = text.translate(_DIGITS).casefold()
    for _ in range(3):  # 1.500.000 needs more than one pass
        t = _THOUSANDS.sub("", t)
    return t


def prices_in(text: str) -> set[str]:
    out = set()
    for m in _PRICE.finditer(normalize(text)):
        value = (m.group(1) or m.group(2)).replace(",", ".")
        out.add(value.split(".")[0] if value.endswith((".0", ".00")) else value)
    return out


@dataclass
class TurnResult:
    answer: str = ""
    cited: list = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    language: str | None = None
    status: str | None = None
    conversation_id: str | None = None
    error: str | None = None
    latency_ms: int | None = None
    first_token_ms: int | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    trace_id: str | None = None


def score_case(case: dict, turns: list[TurnResult], booked: int) -> list[tuple[str, bool, str]]:
    """`turns` are all turns of the case; text checks use the last answer, tool checks use all turns."""
    checks = case.get("checks", {})
    last = turns[-1]
    answer = normalize(last.answer)
    results: list[tuple[str, bool, str]] = []

    if any(t.error for t in turns):
        return [("no_error", False, next(t.error for t in turns if t.error))]
    if not last.answer.strip():
        return [("answered", False, "empty answer")]

    expected_lang = checks.get("language", case.get("language"))
    if expected_lang:
        got = detect_language(last.answer, min_confidence=0.0)
        results.append(("language", got == expected_lang, f"expected {expected_lang}, got {got}"))

    if "contains_any" in checks:
        hit = [w for w in checks["contains_any"] if normalize(w) in answer]
        results.append(("contains_any", bool(hit), f"found {hit}" if hit else f"none of {checks['contains_any']}"))
    if "contains_all" in checks:
        miss = [w for w in checks["contains_all"] if normalize(w) not in answer]
        results.append(("contains_all", not miss, f"missing {miss}" if miss else "all found"))
    if "not_contains" in checks:
        bad = [w for w in checks["not_contains"] if normalize(w) in answer]
        results.append(("not_contains", not bad, f"found forbidden {bad}" if bad else "clean"))
    if "only_prices" in checks:
        allowed = {normalize(p) for p in checks["only_prices"]}
        extra = prices_in(last.answer) - allowed
        results.append(("only_prices", not extra, f"unexpected prices {sorted(extra)}" if extra else "no invented prices"))
    if checks.get("cites"):
        n = len(last.cited)
        results.append(("cites", n > 0, f"{n} source(s) cited"))

    called = {name for t in turns for name in t.tools}
    if "tools" in checks:
        miss = [x for x in checks["tools"] if x not in called]
        results.append(("tools", not miss, f"missing {miss}, called {sorted(called)}" if miss else f"called {sorted(called)}"))
    if "no_tools" in checks:
        bad = [x for x in checks["no_tools"] if x in called]
        results.append(("no_tools", not bad, f"should not call {bad}" if bad else "ok"))
    if "booked" in checks:
        want = checks["booked"]
        results.append(("booked", (booked > 0) == want, f"{booked} appointment(s) booked, expected {'some' if want else 'none'}"))
    if "status" in checks:
        results.append(("status", last.status == checks["status"], f"conversation status {last.status}"))
    return results
