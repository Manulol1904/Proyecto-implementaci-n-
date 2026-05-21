from fastapi import APIRouter, Depends, Header, Request

from pydantic import BaseModel

from app.billing.downloads import download_billing_file
from app.billing.service import BillingKind, assert_billing_access
from app.celery_app import celery_app
from app.core.config import settings
from app.core.errors import bad_request, forbidden
from app.deps.auth import get_current_user


router = APIRouter()


class QueueEmitIn(BaseModel):
    target_kind: BillingKind
    target_id: str


@router.post("/queue-emit")
async def queue_emit(payload: QueueEmitIn, request: Request, x_internal_key: str | None = Header(default=None)):
    """
    Encola emisión Factus tras un pago (llamado por el servicio payments).
    En dev se permite sin clave desde la red Docker.
    """
    if settings.app_env != "dev":
        if not settings.internal_api_key or x_internal_key != settings.internal_api_key:
            raise forbidden("Invalid internal key")
    celery_app.send_task("app.tasks.emit_billing_document", args=[payload.target_kind, payload.target_id])
    return {"ok": True, "queued": True}


@router.post("/{kind}/{doc_id}/retry-factus")
async def retry_factus(kind: BillingKind, doc_id: str, user: dict = Depends(get_current_user)):
    await assert_billing_access(kind, doc_id, user)
    celery_app.send_task("app.tasks.emit_billing_document", args=[kind, doc_id])
    return {"ok": True, "queued": True}


@router.get("/{kind}/{doc_id}/pdf")
async def download_pdf(kind: BillingKind, doc_id: str, user: dict = Depends(get_current_user)):
    doc = await assert_billing_access(kind, doc_id, user)
    return await download_billing_file(billing_kind=kind, doc=doc, file_kind="pdf")


@router.get("/{kind}/{doc_id}/xml")
async def download_xml(kind: BillingKind, doc_id: str, user: dict = Depends(get_current_user)):
    doc = await assert_billing_access(kind, doc_id, user)
    return await download_billing_file(billing_kind=kind, doc=doc, file_kind="xml")
