"""Split long text into overlapping chunks that respect natural boundaries.

We try to cut on paragraph breaks first, then sentence ends, then spaces, so a
chunk rarely ends mid-sentence. Neighbouring chunks overlap a little so an
answer that straddles a boundary is still found.
"""

import re

_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "。", "؟ ", "۔ ", "; ", ", ", " "]


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split(text: str, size: int, seps: list[str]) -> list[str]:
    """Recursively split until every piece is <= size."""
    if len(text) <= size:
        return [text]
    for i, sep in enumerate(seps):
        if sep in text:
            parts = text.split(sep)
            pieces = [p + sep for p in parts[:-1]] + [parts[-1]]
            out: list[str] = []
            for p in pieces:
                out.extend(_split(p, size, seps[i + 1:]) if len(p) > size else [p])
            return [p for p in out if p]
    return [text[i : i + size] for i in range(0, len(text), size)]


def chunk_text(text: str, size: int = 1000, overlap: int = 150) -> list[str]:
    """Return chunks of at most ~`size` chars, each overlapping the previous by ~`overlap`."""
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")
    text = normalize(text)
    if not text:
        return []

    chunks: list[str] = []
    current = ""
    for piece in _split(text, size, _SEPARATORS):
        if len(current) + len(piece) <= size:
            current += piece
            continue
        if current.strip():
            chunks.append(current.strip())
        # Start the next chunk with the tail of the previous one (overlap),
        # cut at a word boundary so it reads naturally.
        tail = current[-overlap:] if overlap else ""
        if " " in tail:
            tail = tail[tail.index(" ") + 1 :]
        current = (tail + piece) if len(tail) + len(piece) <= size else piece
    if current.strip():
        chunks.append(current.strip())
    return chunks
