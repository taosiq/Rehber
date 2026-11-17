import pytest

from app.services.extraction import ExtractionError, _ensure_public_host, extract_pdf


def test_extract_pdf_keeps_page_numbers(pdf_factory):
    out = extract_pdf(pdf_factory(["Opening hours 9 to 5", "Whitening costs 180 dollars"]), "clinic.pdf")
    assert out.title == "clinic"
    assert [p.page for p in out.pages] == [1, 2]
    assert "Whitening" in out.pages[1].text


def test_extract_pdf_rejects_garbage():
    with pytest.raises(ExtractionError):
        extract_pdf(b"%PDF-1.4 this is not really a pdf", "bad.pdf")


@pytest.mark.parametrize(
    "url",
    ["http://localhost:8000/admin", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "ftp://example.com/"],
)
def test_blocks_private_and_non_http_urls(url):
    with pytest.raises(ExtractionError):
        _ensure_public_host(url)
