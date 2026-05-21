from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
import base64
import httpx
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.core.config import settings
from app.core.errors import bad_request, not_found
from app.celery_app import celery_app
from app.db.mongo import mongo
from app.deps.auth import get_current_user, require_role
from app.domain.enums import InvoiceStatus, UserRole
from app.domain.models import InvoiceCreateInternal, InvoicePublic
from app.utils.billing import Period, amount_for_unit, due_date_for_period
from app.utils.ids import new_id


router = APIRouter()


def _factus_enabled() -> bool:
    return bool(settings.factus_client_id and settings.factus_client_secret and settings.factus_username and settings.factus_password)


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
        j = r.json()
    return str(j["access_token"])


async def _factus_download_pdf_bytes(*, number: str) -> tuple[bytes, str]:
    """
    Factus v2: GET /v2/bills/{number}/download-pdf  -> Base64
    """
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
    """
    Factus: GET /v1/bills/download-xml/{number} -> Base64
    """
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


async def _factus_send_email(*, number: str, email: str) -> dict:
    """
    Factus: POST /v1/bills/send-email/{number}
    Docs: https://developers.factus.com.co/facturas/enviar-correo/
    """
    token = await _factus_access_token()
    headers = {"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    payload = {"email": email}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{settings.factus_host.rstrip('/')}/v1/bills/send-email/{number}", json=payload, headers=headers)
        r.raise_for_status()
        return r.json()


def _gridfs_bucket() -> AsyncIOMotorGridFSBucket:
    if mongo.db is None:
        raise bad_request("DB not ready")
    return AsyncIOMotorGridFSBucket(mongo.db, bucket_name="invoice_files")


async def _store_file(invoice_id: str, kind: str, content: bytes, filename: str, content_type: str) -> str:
    bucket = _gridfs_bucket()
    file_id = await bucket.upload_from_stream(
        filename,
        content,
        metadata={"invoice_id": invoice_id, "kind": kind, "content_type": content_type},
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


async def _refresh_overdues() -> None:
    if mongo.db is None:
        return
    now = datetime.now(timezone.utc)
    await mongo.db.invoices.update_many(
        {"status": InvoiceStatus.pendiente.value, "due_date": {"$lt": now}},
        {"$set": {"status": InvoiceStatus.vencida.value}},
    )


async def _assert_invoice_access(invoice_id: str, user: dict) -> dict:
    if mongo.db is None:
        raise bad_request("DB not ready")
    doc = await mongo.db.invoices.find_one({"_id": invoice_id})
    if not doc:
        raise not_found("Invoice not found")
    if user["role"] != UserRole.admin.value:
        unit = await mongo.db.units.find_one({"_id": doc["unit_id"]})
        if not unit or unit.get("resident_user_id") != user["_id"]:
            raise not_found("Invoice not found")
    return doc


@router.get("", response_model=list[InvoicePublic], dependencies=[Depends(require_role(UserRole.admin))])
async def list_invoices(
    status: InvoiceStatus | None = Query(default=None),
    period: str | None = Query(default=None, description="YYYY-MM"),
):
    if mongo.db is None:
        raise bad_request("DB not ready")

    await _refresh_overdues()

    q: dict = {}
    if status is not None:
        q["status"] = status.value
    if period:
        q["period"] = period

    items: list[InvoicePublic] = []
    async for doc in mongo.db.invoices.find(q).sort([("period", -1), ("created_at", -1)]):
        items.append(InvoicePublic(**doc))
    return items


@router.get("/my", response_model=list[InvoicePublic])
async def my_invoices(user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    await _refresh_overdues()

    unit_ids: list[str] = []
    async for u in mongo.db.units.find({"resident_user_id": user["_id"]}, {"_id": 1}):
        unit_ids.append(u["_id"])
    if not unit_ids:
        return []

    items: list[InvoicePublic] = []
    async for doc in mongo.db.invoices.find({"unit_id": {"$in": unit_ids}}).sort(
        [("period", -1), ("created_at", -1)]
    ):
        items.append(InvoicePublic(**doc))
    return items


@router.get("/{invoice_id}", response_model=InvoicePublic)
async def get_invoice(invoice_id: str, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    doc = await mongo.db.invoices.find_one({"_id": invoice_id})
    if not doc:
        raise not_found("Invoice not found")

    # Authorization: admin can view all; resident only their units
    if user["role"] != UserRole.admin.value:
        unit = await mongo.db.units.find_one({"_id": doc["unit_id"]})
        if not unit or unit.get("resident_user_id") != user["_id"]:
            raise not_found("Invoice not found")

    return InvoicePublic(**doc)


@router.get("/{invoice_id}/pdf")
async def download_pdf(invoice_id: str, user: dict = Depends(get_current_user)):
    """
    Proxy autenticado: descarga PDF (si existe url en la factura).
    Evita exponer URLs externas directamente en el frontend.
    """
    if mongo.db is None:
        raise bad_request("DB not ready")

    doc = await mongo.db.invoices.find_one({"_id": invoice_id})
    if not doc:
        raise not_found("Invoice not found")
    if user["role"] != UserRole.admin.value:
        unit = await mongo.db.units.find_one({"_id": doc["unit_id"]})
        if not unit or unit.get("resident_user_id") != user["_id"]:
            raise not_found("Invoice not found")

    # Prefer storage propio (GridFS) si existe (puede quedar huérfano tras reset de Mongo)
    pdf_file_id = doc.get("pdf_file_id")
    if pdf_file_id:
        stored = await _read_stored_file_or_none(str(pdf_file_id))
        if stored:
            data, meta = stored
            ctype = meta.get("content_type") or "application/pdf"
            fname = meta.get("filename") or f"{invoice_id}.pdf"
            return Response(content=data, media_type=ctype, headers={"Content-Disposition": f'inline; filename="{fname}"'})
        await mongo.db.invoices.update_one({"_id": invoice_id}, {"$unset": {"pdf_file_id": ""}})

    url = doc.get("pdf_url") or doc.get("factus_public_url")
    if url:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            content_type = r.headers.get("content-type", "application/pdf")
            # Guarda copia en storage propio para robustez
            try:
                fid = await _store_file(invoice_id, "pdf", r.content, f"{invoice_id}.pdf", content_type)
                await mongo.db.invoices.update_one({"_id": invoice_id}, {"$set": {"pdf_file_id": fid}})
            except Exception:
                pass
            return Response(content=r.content, media_type=content_type)

    number = doc.get("factus_number")
    if number and _factus_enabled():
        try:
            content, fname = await _factus_download_pdf_bytes(number=str(number))
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=_factus_http_detail(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"No se pudo obtener el PDF desde Factus: {exc}") from exc
        try:
            fid = await _store_file(invoice_id, "pdf", content, fname, "application/pdf")
            await mongo.db.invoices.update_one({"_id": invoice_id}, {"$set": {"pdf_file_id": fid}})
        except Exception:
            pass
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{fname}"'},
        )

    raise not_found("PDF no disponible. Emite la factura en Factus o espera unos segundos.")


@router.get("/{invoice_id}/xml")
async def download_xml(invoice_id: str, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    doc = await mongo.db.invoices.find_one({"_id": invoice_id})
    if not doc:
        raise not_found("Invoice not found")
    if user["role"] != UserRole.admin.value:
        unit = await mongo.db.units.find_one({"_id": doc["unit_id"]})
        if not unit or unit.get("resident_user_id") != user["_id"]:
            raise not_found("Invoice not found")

    xml_file_id = doc.get("xml_file_id")
    if xml_file_id:
        stored = await _read_stored_file_or_none(str(xml_file_id))
        if stored:
            data, meta = stored
            ctype = meta.get("content_type") or "application/xml"
            fname = meta.get("filename") or f"{invoice_id}.xml"
            return Response(content=data, media_type=ctype, headers={"Content-Disposition": f'inline; filename="{fname}"'})
        await mongo.db.invoices.update_one({"_id": invoice_id}, {"$unset": {"xml_file_id": ""}})

    url = doc.get("xml_url")
    if url:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            content_type = r.headers.get("content-type", "application/xml")
            try:
                fid = await _store_file(invoice_id, "xml", r.content, f"{invoice_id}.xml", content_type)
                await mongo.db.invoices.update_one({"_id": invoice_id}, {"$set": {"xml_file_id": fid}})
            except Exception:
                pass
            return Response(content=r.content, media_type=content_type)

    number = doc.get("factus_number")
    if number and _factus_enabled():
        try:
            content, fname = await _factus_download_xml_bytes(number=str(number))
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=_factus_http_detail(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"No se pudo obtener el XML desde Factus: {exc}") from exc
        try:
            fid = await _store_file(invoice_id, "xml", content, fname, "application/xml")
            await mongo.db.invoices.update_one({"_id": invoice_id}, {"$set": {"xml_file_id": fid}})
        except Exception:
            pass
        return Response(
            content=content,
            media_type="application/xml",
            headers={"Content-Disposition": f'inline; filename="{fname}"'},
        )

    raise not_found("XML no disponible. Emite la factura en Factus primero.")


@router.post("/generate", response_model=dict, dependencies=[Depends(require_role(UserRole.admin))])
async def generate_invoices(period: str | None = None):
    """
    Generación manual (admin).
    Si no se envía periodo, usa el mes actual (UTC).
    """
    if mongo.db is None:
        raise bad_request("DB not ready")

    now = datetime.now(timezone.utc)
    if period:
        try:
            y, m = period.split("-")
            p = Period(int(y), int(m))
        except Exception:
            raise bad_request("Invalid period. Use YYYY-MM")
    else:
        p = Period.from_date(now.date())

    due_date = due_date_for_period(p, settings.invoice_due_day)

    created = 0
    skipped = 0
    async for unit in mongo.db.units.find({}):
        amount = amount_for_unit(settings.admin_fee_base_cop, float(unit["coefficient"]))
        doc = InvoiceCreateInternal(
            unit_id=unit["_id"],
            period=p.key,
            base_fee_cop=settings.admin_fee_base_cop,
            coefficient=float(unit["coefficient"]),
            amount_cop=amount,
            due_date=due_date,
            created_at=now,
        ).model_dump()
        # ID determinístico para idempotencia (worker/backend consistente)
        doc["_id"] = f"inv_{p.key}_{unit['_id']}"
        doc["status"] = doc["status"].value if hasattr(doc["status"], "value") else doc["status"]
        try:
            await mongo.db.invoices.insert_one(doc)
            created += 1
        except Exception:
            skipped += 1

    return {"period": p.key, "created": created, "skipped_existing": skipped}


@router.delete("/{invoice_id}", dependencies=[Depends(require_role(UserRole.admin))])
async def delete_invoice(invoice_id: str):
    if mongo.db is None:
        raise bad_request("DB not ready")
    res = await mongo.db.invoices.delete_one({"_id": invoice_id})
    if res.deleted_count == 0:
        raise not_found("Invoice not found")
    await mongo.db.payments.delete_many({"invoice_id": invoice_id})
    return {"deleted": True}


@router.post("/{invoice_id}/retry-factus")
async def retry_factus(invoice_id: str, user: dict = Depends(get_current_user)):
    """
    Reintenta emitir factura electrónica vía worker (Celery).
    Admin: cualquier factura. Residente: solo facturas de sus unidades.
    """
    await _assert_invoice_access(invoice_id, user)
    celery_app.send_task("app.tasks.emit_billing_document", args=["invoice", invoice_id])
    return {"queued": True}


@router.post("/{invoice_id}/send-email")
async def send_invoice_email(
    invoice_id: str,
    email: str | None = None,
    user: dict = Depends(get_current_user),
):
    """
    Reenvía la factura electrónica por correo usando Factus.
    - Usa el número `factus_number` de la factura.
    - Si no se envía `email`, se intenta usar el email del residente asignado.
    """
    if mongo.db is None:
        raise bad_request("DB not ready")
    inv = await _assert_invoice_access(invoice_id, user)
    number = inv.get("factus_number")
    if not number:
        raise bad_request("Invoice has no factus_number (not emitted)")
    if not _factus_enabled():
        raise bad_request("Factus not configured in backend")

    target = (email or "").strip() or None
    if not target:
        unit = await mongo.db.units.find_one({"_id": inv.get("unit_id")}) or {}
        if unit.get("resident_user_id"):
            u = await mongo.db.users.find_one({"_id": unit.get("resident_user_id")}) or {}
            target = (u.get("email") or "").strip() or None
    if not target:
        raise bad_request("Email is required (no resident email found)")

    res = await _factus_send_email(number=str(number), email=target)
    return {"ok": True, "factus": res}

