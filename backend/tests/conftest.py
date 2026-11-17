"""Test setup: a separate `rehber_test` database and a fast fake embedder."""

import hashlib
import os
import re

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "postgresql+asyncpg://rehber:rehber@localhost:5432/rehber_test"

import numpy as np  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.embeddings import set_embedder  # noqa: E402


class FakeEmbedder:
    """Bag-of-words hashing embedder: deterministic, instant, and good enough
    that texts sharing words land close together."""

    dim = get_settings().embedding_dim

    def _vec(self, text_: str) -> list[float]:
        v = np.zeros(self.dim, dtype=np.float32)
        for word in re.findall(r"\w+", text_.lower()):
            v[int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim] += 1
        n = np.linalg.norm(v)
        return (v / n if n else v).tolist()

    async def embed_documents(self, texts, titles=None):
        return [self._vec(t) for t in texts]

    async def embed_query(self, text_):
        return self._vec(text_)


@pytest_asyncio.fixture(autouse=True)
async def fresh_db():
    set_embedder(FakeEmbedder())
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    set_embedder(None)


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def make_pdf(pages: list[str]) -> bytes:
    """Build a tiny valid PDF with one line of text per page (no extra deps)."""
    objs: list[bytes] = []
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(len(pages)))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    font_id = 3 + len(pages) * 2
    for i, line in enumerate(pages):
        content_id = 4 + i * 2
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> >>".encode()
        )
        stream = f"BT /F1 12 Tf 72 720 Td ({line}) Tj ET".encode()
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return bytes(out)


@pytest.fixture
def pdf_factory():
    return make_pdf
