"""Detect which of Rehber's 8 languages a customer is writing in."""

import re
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


# Short Latin-script questions are full of shared words ("parking", "hotel", "taxi", "patients"), and the
# statistical detector can pick English for French. Everyday function words are a strong second signal.
# Words that exist in more than one of these languages ("a", "die", "was", "es", "on") are left out.
FUNCTION_WORDS = {
    "en": set("the is are do does you your what how when where can could would there have has my with this that "
              "and of to for from please which who open any".split()),
    "fr": set("le la les un une des est ce qu il elle je vous nous avec pour sur dans du au aux et mon ma mes votre "
              "vos quel quelle quels combien où ouvert pas c y t".split()),
    "de": set("der das ist sind ein eine einen und für mit ich sie wie wann wo gibt haben ihr ihre mein meine "
              "bitte nicht auch zu den dem geöffnet".split()),
    "tr": set("bir ve mi mı mu mü ne nasıl nerede var yok için ile bu şu ben siz misiniz kaç saat "
              "açık mısınız neden".split()),
}
_WORD = re.compile(r"[a-zà-ÿçğıöşüœß]+")


def _function_word_vote(text: str) -> dict[str, int]:
    words = _WORD.findall(text.lower())
    return {lang: sum(w in vocab for w in words) for lang, vocab in FUNCTION_WORDS.items()}


def detect_language(text: str, fallback: str | None = None, min_confidence: float = 0.5) -> str | None:
    """Return a code like "tr", or `fallback` when the text is too short or unclear (e.g. "ok")."""
    letters = sum(ch.isalpha() for ch in text)
    if letters < 3:
        return fallback
    best = _detector().compute_language_confidence_values(text)[0]
    code = SUPPORTED[best.language][0]
    if code in FUNCTION_WORDS and best.value < 0.9:
        votes = _function_word_vote(text)
        winner = max(votes, key=votes.get)
        if winner != code and votes[winner] >= 2 and votes[winner] >= votes[code] + 2:
            return winner
    if best.value < min_confidence and fallback:
        return fallback
    return code
