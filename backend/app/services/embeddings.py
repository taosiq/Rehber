"""Text embeddings.

Default: EmbeddingGemma running locally on CPU via fastembed (ONNX). It's free,
private and handles all 8 Rehber languages. The model (~1.2 GB) downloads on
first use into `backend/.models`.
"""

import asyncio
import threading
from typing import Protocol

import numpy as np

from app.core.config import get_settings


class Embedder(Protocol):
    dim: int

    async def embed_documents(self, texts: list[str], titles: list[str] | None = None) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...


def _normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.clip(norms, 1e-12, None)


class LocalGemmaEmbedder:
    """EmbeddingGemma with its recommended task prompts."""

    QUERY_PREFIX = "task: search result | query: "
    DOC_TEMPLATE = "title: {title} | text: {text}"

    def __init__(self, model_name: str, cache_dir: str, dim: int):
        self.model_name = model_name
        self.cache_dir = cache_dir
        self.dim = dim
        self._model = None
        self._lock = threading.Lock()
        self._run_lock = asyncio.Lock()  # one CPU-heavy batch at a time

    def _load(self):
        with self._lock:
            if self._model is None:
                from fastembed import TextEmbedding  # heavy import, keep lazy

                self._model = TextEmbedding(self.model_name, cache_dir=self.cache_dir)
        return self._model

    def warm_up(self) -> None:
        self._load()

    def _embed(self, texts: list[str]) -> list[list[float]]:
        model = self._load()
        vectors = np.array(list(model.embed(texts, batch_size=16)), dtype=np.float32)
        return _normalize(vectors).tolist()

    async def embed_documents(self, texts: list[str], titles: list[str] | None = None) -> list[list[float]]:
        titles = titles or ["none"] * len(texts)
        inputs = [self.DOC_TEMPLATE.format(title=(t or "none"), text=x) for t, x in zip(titles, texts)]
        async with self._run_lock:
            return await asyncio.to_thread(self._embed, inputs)

    async def embed_query(self, text: str) -> list[float]:
        async with self._run_lock:
            return (await asyncio.to_thread(self._embed, [self.QUERY_PREFIX + text]))[0]


_embedder: Embedder | None = None


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        s = get_settings()
        _embedder = LocalGemmaEmbedder(s.embedding_model, str(s.models_dir), s.embedding_dim)
    return _embedder


def set_embedder(embedder: Embedder | None) -> None:
    """Swap the embedder (used by tests)."""
    global _embedder
    _embedder = embedder
