import uuid
from functools import partial
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant
from app.core.config import BACKEND_DIR, get_settings
from app.db.session import get_db
from app.models import Document, Tenant
from app.schemas import DocumentOut, TextDocumentCreate, UrlDocumentCreate
from app.services.extraction import Extracted, Page, extract_pdf, extract_url
from app.services.ingestion import ingest_document

router = APIRouter(prefix="/tenants/{tenant_id}/documents", tags=["documents"])

STORAGE_DIR = BACKEND_DIR / "storage"


def _pdf_path(doc: Document) -> Path:
    return STORAGE_DIR / str(doc.tenant_id) / f"{doc.id}.pdf"


def _extractor_for(doc: Document):
    """Build the extract() callable the background pipeline will run."""
    if doc.source_type == "pdf":
        async def run() -> Extracted:
            return extract_pdf(_pdf_path(doc).read_bytes(), doc.title + ".pdf")
        return run
    if doc.source_type == "url":
        return partial(extract_url, doc.source_uri)
    raise HTTPException(400, "This document type can't be reprocessed.")


async def _get_doc(db: AsyncSession, tenant: Tenant, document_id: uuid.UUID) -> Document:
    doc = await db.get(Document, document_id)
    if doc is None or doc.tenant_id != tenant.id:  # never leak other tenants' docs
        raise HTTPException(404, "Document not found")
    return doc


@router.post("/upload", response_model=DocumentOut, status_code=202)
async def upload_pdf(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
) -> Document:
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"File is larger than {get_settings().max_upload_mb} MB.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Only PDF files are supported right now.")

    name = Path(file.filename or "document.pdf").name
    doc = Document(tenant_id=tenant.id, title=name.rsplit(".", 1)[0][:500], source_type="pdf", source_uri=name)
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    path = _pdf_path(doc)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

    background.add_task(ingest_document, doc.id, _extractor_for(doc))
    return doc


@router.post("/url", response_model=DocumentOut, status_code=202)
async def add_url(
    body: UrlDocumentCreate,
    background: BackgroundTasks,
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
) -> Document:
    url = str(body.url)
    doc = Document(tenant_id=tenant.id, title=url[:500], source_type="url", source_uri=url)
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    background.add_task(ingest_document, doc.id, _extractor_for(doc))
    return doc


@router.post("/text", response_model=DocumentOut, status_code=202)
async def add_text(
    body: TextDocumentCreate,
    background: BackgroundTasks,
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
) -> Document:
    doc = Document(tenant_id=tenant.id, title=body.title, source_type="text")
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    async def run() -> Extracted:
        return Extracted(title=body.title, pages=[Page(text=body.text)])

    background.add_task(ingest_document, doc.id, run)
    return doc


@router.get("", response_model=list[DocumentOut])
async def list_documents(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> list[Document]:
    stmt = select(Document).where(Document.tenant_id == tenant.id).order_by(Document.created_at.desc())
    return list((await db.scalars(stmt)).all())


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
) -> Document:
    return await _get_doc(db, tenant, document_id)


@router.post("/{document_id}/reprocess", response_model=DocumentOut, status_code=202)
async def reprocess_document(
    document_id: uuid.UUID,
    background: BackgroundTasks,
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
) -> Document:
    doc = await _get_doc(db, tenant, document_id)
    extractor = _extractor_for(doc)
    doc.status, doc.error = "pending", None
    await db.commit()
    background.add_task(ingest_document, doc.id, extractor)
    return doc


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
) -> None:
    doc = await _get_doc(db, tenant, document_id)
    if doc.source_type == "pdf":
        _pdf_path(doc).unlink(missing_ok=True)
    await db.delete(doc)
    await db.commit()
