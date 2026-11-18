"""Language detection on short questions full of shared words (found by the evaluation set)."""

import pytest

from app.services.language import detect_language

CASES = [
    ("Est-ce qu'il y a un parking pour les patients ?", "fr"),
    ("Y a-t-il un parking ?", "fr"),
    ("Parking pour les patients", "fr"),
    ("Combien coûte un taxi pour l'hôtel ?", "fr"),
    ("Is there a taxi to the hotel?", "en"),
    ("Do you have parking for patients?", "en"),
    ("Hotel parking price?", "en"),
    ("Gibt es einen Parkplatz für Patienten?", "de"),
    ("Wie viel kostet ein Taxi zum Hotel?", "de"),
    ("Taksi var mı?", "tr"),
    ("Otel için taksi var mı?", "tr"),
    ("هل يوجد موقف سيارات؟", "ar"),
    ("آیا پارکینگ دارید؟", "fa"),
    ("کیا پارکنگ ہے؟", "ur"),
    ("Есть ли парковка?", "ru"),
]


@pytest.mark.parametrize(("text", "expected"), CASES)
def test_detects_language_of_short_questions(text, expected):
    assert detect_language(text) == expected


def test_short_unclear_text_uses_fallback():
    assert detect_language("ok", fallback="tr") == "tr"
