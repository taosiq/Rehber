"""Request/response shapes for the public API."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class TenantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    default_language: str = Field(default="en", max_length=5)


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    slug: str
    default_language: str
    created_at: datetime


class UrlDocumentCreate(BaseModel):
    url: HttpUrl


class TextDocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    text: str = Field(min_length=1, max_length=500_000)


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    source_type: str
    source_uri: str | None
    status: str
    error: str | None
    chunk_count: int
    char_count: int
    created_at: datetime


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=5, ge=1, le=20)


class SearchHitOut(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    source_type: str
    source_uri: str | None
    page: int | None
    content: str
    score: float


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHitOut]
    took_ms: int
