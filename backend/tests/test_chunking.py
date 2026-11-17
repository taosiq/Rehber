import pytest

from app.services.chunking import chunk_text, normalize


def test_short_text_is_one_chunk():
    assert chunk_text("Hello world.", size=100, overlap=10) == ["Hello world."]


def test_empty_text_gives_no_chunks():
    assert chunk_text("   \n\n  ", size=100, overlap=10) == []


def test_chunks_respect_size_and_cover_all_text():
    paragraphs = [f"Paragraph {i}. " + "Sentence about opening hours and prices. " * 6 for i in range(12)]
    text = "\n\n".join(paragraphs)
    chunks = chunk_text(text, size=400, overlap=60)
    assert len(chunks) > 3
    assert all(len(c) <= 400 for c in chunks)
    for i in range(12):  # nothing lost
        assert any(f"Paragraph {i}." in c for c in chunks)


def test_chunks_overlap():
    text = " ".join(f"word{i}" for i in range(400))
    chunks = chunk_text(text, size=200, overlap=50)
    for a, b in zip(chunks, chunks[1:]):
        assert a.split()[-1] in b  # last word of a chunk reappears in the next


def test_prefers_sentence_boundaries():
    text = "First sentence is here. " * 30
    for c in chunk_text(text, size=150, overlap=0):
        assert c.endswith(".")


def test_handles_rtl_and_non_latin_text():
    text = ("ساعات العمل من التاسعة صباحاً حتى الثانية ظهراً. " * 40) + ("Часы работы с 9 до 18. " * 40)
    chunks = chunk_text(text, size=300, overlap=40)
    assert all(len(c) <= 300 for c in chunks)
    assert any("ساعات" in c for c in chunks) and any("Часы" in c for c in chunks)


def test_normalize_collapses_whitespace():
    assert normalize("a\r\n\r\n\r\n\r\nb   c d") == "a\n\nb c d"


def test_overlap_must_be_smaller_than_size():
    with pytest.raises(ValueError):
        chunk_text("x", size=10, overlap=10)
