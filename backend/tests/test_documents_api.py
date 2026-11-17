"""End-to-end API flow: create business -> add documents -> search."""


async def _tenant(client, name="Lumen Dental"):
    res = await client.post("/api/tenants", json={"name": name})
    assert res.status_code == 201
    return res.json()["id"]


async def test_pdf_upload_is_chunked_embedded_and_searchable(client, pdf_factory):
    tid = await _tenant(client)
    pdf = pdf_factory(["We are open Monday to Friday", "Teeth whitening costs 180 dollars"])

    res = await client.post(
        f"/api/tenants/{tid}/documents/upload", files={"file": ("services.pdf", pdf, "application/pdf")}
    )
    assert res.status_code == 202
    doc_id = res.json()["id"]

    doc = (await client.get(f"/api/tenants/{tid}/documents/{doc_id}")).json()
    assert doc["status"] == "ready", doc
    assert doc["chunk_count"] == 2

    hits = (await client.post(f"/api/tenants/{tid}/search", json={"query": "whitening costs"})).json()["hits"]
    assert hits[0]["page"] == 2
    assert "whitening" in hits[0]["content"].lower()
    assert hits[0]["document_title"] == "services"


async def test_text_document(client):
    tid = await _tenant(client)
    res = await client.post(
        f"/api/tenants/{tid}/documents/text",
        json={"title": "Returns policy", "text": "Returns are free within 14 days."},
    )
    assert res.status_code == 202
    hits = (await client.post(f"/api/tenants/{tid}/search", json={"query": "free returns"})).json()["hits"]
    assert hits and hits[0]["document_title"] == "Returns policy"


async def test_tenants_cannot_see_each_others_data(client):
    a = await _tenant(client, "Business A")
    b = await _tenant(client, "Business B")
    doc = (
        await client.post(f"/api/tenants/{a}/documents/text", json={"title": "Secret", "text": "secret pricing"})
    ).json()

    assert (await client.post(f"/api/tenants/{b}/search", json={"query": "secret pricing"})).json()["hits"] == []
    assert (await client.get(f"/api/tenants/{b}/documents")).json() == []
    assert (await client.get(f"/api/tenants/{b}/documents/{doc['id']}")).status_code == 404
    assert (await client.delete(f"/api/tenants/{b}/documents/{doc['id']}")).status_code == 404


async def test_rejects_non_pdf_upload(client):
    tid = await _tenant(client)
    res = await client.post(
        f"/api/tenants/{tid}/documents/upload", files={"file": ("x.pdf", b"hello", "application/pdf")}
    )
    assert res.status_code == 415


async def test_bad_pdf_marks_document_failed(client):
    tid = await _tenant(client)
    res = await client.post(
        f"/api/tenants/{tid}/documents/upload", files={"file": ("bad.pdf", b"%PDF-1.4 junk", "application/pdf")}
    )
    doc = (await client.get(f"/api/tenants/{tid}/documents/{res.json()['id']}")).json()
    assert doc["status"] == "failed"
    assert doc["error"]


async def test_private_url_is_rejected(client):
    tid = await _tenant(client)
    res = await client.post(f"/api/tenants/{tid}/documents/url", json={"url": "http://127.0.0.1:5432/"})
    doc = (await client.get(f"/api/tenants/{tid}/documents/{res.json()['id']}")).json()
    assert doc["status"] == "failed"
    assert "private" in doc["error"]


async def test_delete_document_removes_it_from_search(client):
    tid = await _tenant(client)
    doc = (
        await client.post(f"/api/tenants/{tid}/documents/text", json={"title": "Hours", "text": "Open on Sundays"})
    ).json()
    assert (await client.delete(f"/api/tenants/{tid}/documents/{doc['id']}")).status_code == 204
    assert (await client.post(f"/api/tenants/{tid}/search", json={"query": "Sundays"})).json()["hits"] == []


async def test_unknown_tenant_404(client):
    res = await client.get("/api/tenants/00000000-0000-0000-0000-000000000000/documents")
    assert res.status_code == 404
