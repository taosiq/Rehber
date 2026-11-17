"""Semantic search over a tenant's chunks with pgvector."""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Chunk, Document
from app.services.embeddings import get_embedder


@dataclass
class SearchHit:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    source_type: str
    source_uri: str | None
    page: int | None
    content: str
    score: float  # cosine similarity, higher is better


async def search_chunks(db: AsyncSession, tenant_id: uuid.UUID, query: str, k: int = 5) -> list[SearchHit]:
    query_vec = await get_embedder().embed_query(query)
    distance = Chunk.embedding.cosine_distance(query_vec)
    stmt = (
        select(Chunk, Document, distance.label("distance"))
        .join(Document, Document.id == Chunk.document_id)
        .where(Chunk.tenant_id == tenant_id, Document.status == "ready")  # tenant isolation
        .order_by(distance)
        .limit(k)
    )
    rows = (await db.execute(stmt)).all()
    return [
        SearchHit(
            chunk_id=chunk.id,
            document_id=doc.id,
            document_title=doc.title,
            source_type=doc.source_type,
            source_uri=doc.source_uri,
            page=chunk.page,
            content=chunk.content,
            score=round(1 - float(dist), 4),
        )
        for chunk, doc, dist in rows
    ]
