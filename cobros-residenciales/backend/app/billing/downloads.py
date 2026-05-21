from __future__ import annotations

import base64

import httpx
from fastapi import HTTPException
from fastapi.responses import Response
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.billing.service import COLLECTION_BY_KIND, BillingKind
from app.core.config import settings
from app.core.errors import bad_request, not_found
from app.db.mongo import mongo


def _factus_enabled() -> bool:
    return bool(
        settings.factus_client_id
        and settings.factus_client_secret
        and settings.factus_username
        and settings.factus_password
        and settings.factus_numbering_range_id
    )


async def _factus_access_token() -> str:
    data = {
        "grant_type": "password",
        "client_id": settings.factus_client_id or "",
        "client_secret": settings.factus_client_secret or "",
        "username": settings.factus_username or "",
        "password": settings.factus_password or "",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{settings.factus_host.rstrip('/')}/oauth/token", data=data)
        r.raise_for_status()
        return str(r.json()["access_token"])


async def _factus_download_pdf_bytes(*, number: str) -> tuple[bytes, str]:
    token = await _factus_access_token()
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{settings.factus_host.rstrip('/')}/v2/bills/{number}/download-pdf", headers=headers)
        r.raise_for_status()
        j = r.json()
    data = j.get("data") or {}
    b64 = data.get("pdf_base_64_encoded") or ""
    fname = (data.get("file_name") or f"factura_{number}") + ".pdf"
    return base64.b64decode(b64), fname


async def _factus_download_xml_bytes(*, number: str) -> tuple[bytes, str]:
    token = await _factus_access_token()
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{settings.factus_host.rstrip('/')}/v1/bills/download-xml/{number}", headers=headers)
        r.raise_for_status()
        j = r.json()
    data = j.get("data") or {}
    b64 = data.get("xml_base_64_encoded") or ""
    fname = (data.get("file_name") or f"factura_{number}") + ".xml"
    return base64.b64decode(b64), fname


def _gridfs_bucket() -> AsyncIOMotorGridFSBucket:
    if mongo.db is None:
        raise bad_request("DB not ready")
    return AsyncIOMotorGridFSBucket(mongo.db, bucket_name="invoice_files")


async def _store_file(doc_id: str, kind: str, content: bytes, filename: str, content_type: str) -> str:
    bucket = _gridfs_bucket()
    file_id = await bucket.upload_from_stream(
        filename,
        content,
        metadata={"invoice_id": doc_id, "kind": kind, "content_type": content_type},
    )
    return str(file_id)


async def _read_file(file_id: str) -> tuple[bytes, dict]:
    bucket = _gridfs_bucket()
    stream = await bucket.open_download_stream(file_id)
    data = await stream.read()
    meta = stream.metadata or {}
    meta["filename"] = stream.filename
    return data, meta


async def _read_stored_file_or_none(file_id: str) -> tuple[bytes, dict] | None:
    try:
        return await _read_file(file_id)
    except NoFile:
        return None


def _factus_http_detail(exc: httpx.HTTPStatusError) -> str:
    try:
        body = exc.response.json()
        if isinstance(body, dict):
            msg = body.get("message") or body.get("error") or body.get("detail")
            if msg:
                return str(msg)
    except Exception:
        pass
    return f"Factus respondió {exc.response.status_code}"


async def download_billing_file(*, billing_kind: BillingKind, doc: dict, file_kind: str) -> Response:
    if mongo.db is None:
        raise bad_request("DB not ready")

    doc_id = doc["_id"]
    coll = COLLECTION_BY_KIND[billing_kind]
    file_id_field = f"{file_kind}_file_id"
    url_field = f"{file_kind}_url"
    media = "application/pdf" if file_kind == "pdf" else "application/xml"

    stored_id = doc.get(file_id_field)
    if stored_id:
        stored = await _read_stored_file_or_none(str(stored_id))
        if stored:
            data, meta = stored
            ctype = meta.get("content_type") or media
            fname = meta.get("filename") or f"{doc_id}.{file_kind}"
            return Response(content=data, media_type=ctype, headers={"Content-Disposition": f'inline; filename="{fname}"'})
        await mongo.db[coll].update_one({"_id": doc_id}, {"$unset": {file_id_field: ""}})

    url = doc.get(url_field) or (doc.get("factus_public_url") if file_kind == "pdf" else None)
    if url:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            content_type = r.headers.get("content-type", media)
            try:
                fid = await _store_file(doc_id, file_kind, r.content, f"{doc_id}.{file_kind}", content_type)
                await mongo.db[coll].update_one({"_id": doc_id}, {"$set": {file_id_field: fid}})
            except Exception:
                pass
            return Response(content=r.content, media_type=content_type)

    number = doc.get("factus_number")
    if number and _factus_enabled():
        try:
            if file_kind == "pdf":
                content, fname = await _factus_download_pdf_bytes(number=str(number))
            else:
                content, fname = await _factus_download_xml_bytes(number=str(number))
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=_factus_http_detail(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"No se pudo obtener el {file_kind.upper()} desde Factus: {exc}") from exc
        try:
            fid = await _store_file(doc_id, file_kind, content, fname, media)
            await mongo.db[coll].update_one({"_id": doc_id}, {"$set": {file_id_field: fid}})
        except Exception:
            pass
        return Response(
            content=content,
            media_type=media,
            headers={"Content-Disposition": f'inline; filename="{fname}"'},
        )

    raise not_found(f"{file_kind.upper()} no disponible. Emite la factura en Factus primero.")
