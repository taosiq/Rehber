"""Background pipeline: extract -> chunk -> embed -> store.

Runs after the upload request has returned, updating `Document.status` so the
dashboard can show live progress.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import delete

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import Chunk, Document
from app.services.chunking import chunk_text
from app.services.embeddings import get_embedder
from app.services.extraction import Extracted, ExtractionError

log = logging.getLogger(__name__)

EMBED_BATCH = 32


async def ingest_document(document_id: uuid.UUID, extract: Callable[[], Awaitable[Extracted]]) -> None:
    settings = get_settings()
    async with SessionLocal() as db:
        doc = await db.get(Document, document_id)
        if doc is None:
            return
        doc.status = "processing"
        await db.commit()

        try:
            extracted = await extract()
            if doc.source_type == "url" and extracted.title:
                doc.title = extracted.title

            # Chunk each page separately so we remember page numbers for citations.
            pieces: list[tuple[str, int | None]] = []
            for page in extracted.pages:
                for text in chunk_text(page.text, settings.chunk_size, settings.chunk_overlap):
                    pieces.append((text, page.page))
            if not pieces:
                raise ExtractionError("The document contained no usable text.")

            embedder = get_embedder()
            await db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
            for start in range(0, len(pieces), EMBED_BATCH):
                batch = pieces[start : start + EMBED_BATCH]
                vectors = await embedder.embed_documents([t for t, _ in batch], [doc.title] * len(batch))
                db.add_all(
                    Chunk(
                        tenant_id=doc.tenant_id,
                        document_id=doc.id,
                        position=start + i,
                        content=text,
                        page=page,
                        embedding=vec,
                    )
                    for i, ((text, page), vec) in enumerate(zip(batch, vectors))
                )

            doc.chunk_count = len(pieces)
            doc.char_count = sum(len(t) for t, _ in pieces)
            doc.status = "ready"
            doc.error = None
            await db.commit()
        except ExtractionError as exc:
            await db.rollback()
            await _mark_failed(document_id, str(exc))
        except Exception:
            log.exception("Ingestion failed for %s", document_id)
            await db.rollback()
            await _mark_failed(document_id, "Something went wrong while processing this document.")


async def _mark_failed(document_id: uuid.UUID, message: str) -> None:
    async with SessionLocal() as db:
        doc = await db.get(Document, document_id)
        if doc:
            doc.status = "failed"
            doc.error = message
            await db.commit()
