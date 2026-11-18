"""Detect which of Rehber's 8 languages a customer is writing in."""

from functools import lru_cache

from lingua import Language, LanguageDetectorBuilder

SUPPORTED = {
    Language.ENGLISH: ("en", "English"),
    Language.TURKISH: ("tr", "Turkish"),
    Language.GERMAN: ("de", "German"),
    Language.RUSSIAN: ("ru", "Russian"),
    Language.FRENCH: ("fr", "French"),
    Language.ARABIC: ("ar", "Arabic"),
    Language.PERSIAN: ("fa", "Persian"),
    Language.URDU: ("ur", "Urdu"),
}
NAMES = dict(SUPPORTED.values())  # "tr" -> "Turkish"
RTL = {"ar", "fa", "ur"}


@lru_cache
def _detector():
    return LanguageDetectorBuilder.from_languages(*SUPPORTED).with_preloaded_language_models().build()


def detect_language(text: str, fallback: str | None = None, min_confidence: float = 0.5) -> str | None:
    """Return a code like "tr", or `fallback` when the text is too short or unclear (e.g. "ok")."""
    letters = sum(ch.isalpha() for ch in text)
    if letters < 3:
        return fallback
    best = _detector().compute_language_confidence_values(text)[0]
    if best.value < min_confidence and fallback:
        return fallback
    return SUPPORTED[best.language][0]
