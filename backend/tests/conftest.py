"""Test setup: a separate `rehber_test` database and a fast fake embedder."""

import hashlib
import json
import os
import re

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "postgresql+asyncpg://rehber:rehber@127.0.0.1:5432/rehber_test"
os.environ["REDIS_URL"] = "redis://127.0.0.1:6379/15"  # separate Redis DB, flushed per test
os.environ["SECRET_KEY"] = "test-secret-key-0123456789-abcdefghijklmnop"

import numpy as np  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.ratelimit import get_redis, reset_redis_client  # noqa: E402
from app.db.session import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.embeddings import set_embedder  # noqa: E402
from app.services.agent.model import set_chat_model  # noqa: E402
from langchain_core.language_models import BaseChatModel  # noqa: E402
from langchain_core.messages import AIMessage, AIMessageChunk  # noqa: E402
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult  # noqa: E402


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


class RateLimitError(Exception):
    """Stands in for the provider's rate-limit error."""


class FakeChatModel(BaseChatModel):
    """A scripted LangChain chat model.

    `script` is a list of turns; each turn is either a reply string or a list of
    tool calls [(name, args), ...]. When the script runs out it repeats `reply`.
    Every call's messages are recorded in `calls`.
    """

    model_name: str = "fake-model"
    script: list = []
    reply: str = "Yes, we are open on Saturday [1]."
    fail: bool = False
    calls: list = []
    tools: list = []

    @property
    def _llm_type(self) -> str:
        return "fake"

    def bind_tools(self, tools, **kwargs):
        self.tools = [t.name for t in tools]
        return self

    def _next(self, messages) -> AIMessage:
        self.calls.append(list(messages))
        if self.fail:
            raise RateLimitError("quota")
        turn = self.script.pop(0) if self.script else self.reply
        usage = {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}
        if isinstance(turn, list):
            calls = [{"name": n, "args": a, "id": f"call_{len(self.calls)}_{i}", "type": "tool_call"}
                     for i, (n, a) in enumerate(turn)]
            return AIMessage(content="", tool_calls=calls, usage_metadata=usage)
        return AIMessage(content=turn, usage_metadata=usage)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        msg = self._next(messages)
        if msg.tool_calls:
            chunks = [AIMessageChunk(content="", tool_call_chunks=[
                {"name": tc["name"], "args": json.dumps(tc["args"]), "id": tc["id"], "index": i}
                for i, tc in enumerate(msg.tool_calls)])]
        else:
            words = msg.content.split(" ")
            chunks = [AIMessageChunk(content=w + ("" if i == len(words) - 1 else " ")) for i, w in enumerate(words)]
        chunks[-1] = chunks[-1] + AIMessageChunk(content="", usage_metadata=msg.usage_metadata)
        for c in chunks:
            if run_manager and c.content:
                await run_manager.on_llm_new_token(c.content, chunk=ChatGenerationChunk(message=c))
            yield ChatGenerationChunk(message=c)


@pytest.fixture
def fake_llm():
    llm = FakeChatModel(script=[], calls=[])
    set_chat_model(llm)
    yield llm
    set_chat_model(None)


@pytest_asyncio.fixture(autouse=True)
async def fresh_db():
    set_embedder(FakeEmbedder())
    reset_redis_client()  # each test has its own event loop
    await get_redis().flushdb()
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    set_embedder(None)
    await get_redis().aclose()
    reset_redis_client()


PASSWORD = "correct-horse-battery-9"


def new_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def login_as(c: AsyncClient, email: str, name: str = "Test User") -> dict:
    """Sign up (or log in) and attach the CSRF header, like the dashboard does."""
    res = await c.post("/api/auth/signup", json={"name": name, "email": email, "password": PASSWORD})
    if res.status_code == 409:
        res = await c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert res.status_code in (200, 201), res.text
    me = res.json()
    c.headers["X-CSRF-Token"] = me["csrf_token"]
    return me


@pytest_asyncio.fixture
async def client():
    """A logged-in business owner."""
    async with new_client() as c:
        await login_as(c, "owner@example.com", "Owner")
        yield c


@pytest_asyncio.fixture
async def anon_client():
    async with new_client() as c:
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
