"""Numbered citations shared by the prompt, the search tool and the final answer."""

import re
from dataclasses import asdict, dataclass

from app.services.search import SearchHit


@dataclass
class Source:
    n: int  # citation number shown to the model and the user
    chunk_id: str
    document_id: str
    document_title: str
    source_type: str
    source_uri: str | None
    page: int | None
    content: str
    score: float

    def to_dict(self) -> dict:
        return asdict(self)


class SourceRegistry:
    """Gives each retrieved passage a stable number for this answer (deduplicated)."""

    def __init__(self) -> None:
        self._items: list[Source] = []
        self._by_chunk: dict[str, Source] = {}

    def add(self, hits: list[SearchHit]) -> list[Source]:
        added = []
        for h in hits:
            key = str(h.chunk_id)
            if key not in self._by_chunk:
                src = Source(
                    n=len(self._items) + 1,
                    chunk_id=key,
                    document_id=str(h.document_id),
                    document_title=h.document_title,
                    source_type=h.source_type,
                    source_uri=h.source_uri,
                    page=h.page,
                    content=h.content,
                    score=h.score,
                )
                self._items.append(src)
                self._by_chunk[key] = src
            added.append(self._by_chunk[key])
        return added

    @property
    def all(self) -> list[Source]:
        return list(self._items)

    def cited_in(self, text: str) -> list[Source]:
        by_n = {s.n: s for s in self._items}
        return [by_n[n] for n in cited_numbers(text) if n in by_n]


def format_sources(sources: list[Source]) -> str:
    blocks = []
    for s in sources:
        where = s.document_title + (f", page {s.page}" if s.page else "")
        blocks.append(f"[{s.n}] ({where})\n{s.content}")
    return "\n\n".join(blocks)


def cited_numbers(text: str) -> list[int]:
    """Numbers cited like [1], [2, 3] or 【4】 in the answer, in first-seen order."""
    seen: list[int] = []
    for group in re.findall(r"[\[【](\d+(?:\s*,\s*\d+)*)[\]】]", text):
        for n in group.split(","):
            if (v := int(n)) not in seen:
                seen.append(v)
    return seen
