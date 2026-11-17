"""Turn uploaded files and web pages into plain text."""

import asyncio
import io
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
import trafilatura
from pypdf import PdfReader


class ExtractionError(Exception):
    """Raised when a document can't be read; the message is shown to the user."""


@dataclass
class Page:
    text: str
    page: int | None = None  # 1-based page number for PDFs


@dataclass
class Extracted:
    title: str
    pages: list[Page]


def extract_pdf(data: bytes, filename: str = "document.pdf") -> Extracted:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            reader.decrypt("")
        pages = [Page(text=(p.extract_text() or ""), page=i + 1) for i, p in enumerate(reader.pages)]
    except Exception as exc:  # pypdf raises many different error types
        raise ExtractionError(f"Could not read this PDF ({exc.__class__.__name__}).") from exc

    if not any(p.text.strip() for p in pages):
        raise ExtractionError(
            "No text found in this PDF. It may be a scanned image; OCR support comes later."
        )
    meta_title = (reader.metadata.title if reader.metadata else None) or ""
    title = meta_title.strip() or filename.rsplit(".", 1)[0]
    return Extracted(title=title, pages=pages)


def _ensure_public_host(url: str) -> None:
    """Block requests to localhost / private networks (SSRF protection)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ExtractionError("Please enter a full http(s):// web address.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise ExtractionError("That website address could not be found.") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ExtractionError("That address points to a private network and is not allowed.")


async def extract_url(url: str) -> Extracted:
    await asyncio.to_thread(_ensure_public_host, url)
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=20,
            headers={
                # Identify honestly; sites that disallow bots will refuse with a clear error.
                "User-Agent": "RehberBot/0.2 (+https://github.com/taosiq/Rehber)",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en,tr;q=0.9,*;q=0.5",
            },
        ) as client:
            res = await client.get(url)
            res.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ExtractionError(f"The website refused the request (HTTP {exc.response.status_code}).") from exc
    except httpx.HTTPError as exc:
        raise ExtractionError(f"Could not download the page ({exc.__class__.__name__}).") from exc
    # Redirects could land on a private host; check the final URL too.
    await asyncio.to_thread(_ensure_public_host, str(res.url))

    html = res.text
    text = trafilatura.extract(html, include_tables=True, include_comments=False, favor_recall=True)
    if not text or not text.strip():
        raise ExtractionError("No readable text found on that page.")
    meta = trafilatura.extract_metadata(html)
    title = (meta.title if meta and meta.title else "") or (urlparse(str(res.url)).hostname or url)
    return Extracted(title=title.strip()[:500], pages=[Page(text=text)])
