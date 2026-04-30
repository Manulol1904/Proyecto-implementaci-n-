from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import hashlib
import hmac
import structlog
import httpx
import base64
from jose import jwt

from app.core.config import settings
from app.core.logging import configure_logging
from app.db import connect_mongo, disconnect_mongo, mongo
from app.models import PaymentCreate, PaymentCreated, PaymentPublic, WebhookEvent


configure_logging()
log = structlog.get_logger()

app = FastAPI(title="Cobros Residenciales - Payments", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    connect_mongo()


@app.on_event("shutdown")
def _shutdown():
    disconnect_mongo()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/payments", response_model=PaymentCreated)
def create_payment(payload: PaymentCreate, request: Request):
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")

    user = _require_user(request)

    inv = mongo.db.invoices.find_one({"_id": payload.invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.get("status") == "Pagada":
        raise HTTPException(status_code=400, detail="Invoice already paid")

    # Ownership: resident can only pay invoices from their assigned units
    if user.get("role") == "resident":
        unit = mongo.db.units.find_one({"_id": inv.get("unit_id")})
        if not unit or unit.get("resident_user_id") != user.get("_id"):
            raise HTTPException(status_code=403, detail="Not allowed to pay this invoice")

    # Provider is server-side configuration (avoid client spoofing).
    # In dev/demo we allow UI to choose provider for testing.
    requested = (payload.provider or "").lower().strip()
    if settings.app_env == "dev" and requested in {"mock", "wompi", "epayco"}:
        provider = requested
    else:
        provider = (settings.payments_provider or "mock").lower()
    payment_id = f"pay_{provider}_{int(datetime.now(timezone.utc).timestamp())}_{payload.invoice_id[:8]}"

    origin = request.headers.get("origin") or "http://localhost:5173"

    payment_link: str
    provider_ref: str | None = None
    if provider == "wompi":
        payment_link, provider_ref = _create_wompi_payment_link(
            invoice_id=payload.invoice_id,
            amount_cop=int(inv.get("amount_cop", 0)),
            origin=origin,
        )
    elif provider == "epayco":
        payment_link, provider_ref = _create_epayco_session(
            invoice_id=payload.invoice_id,
            amount_cop=int(inv.get("amount_cop", 0)),
        )
    else:
        # En mock: el "payment link" solo apunta a un endpoint del mismo servicio para simular confirmación.
        payment_link = f"{origin}/mock-pay?payment_id={payment_id}"

    doc = {
        "_id": payment_id,
        "invoice_id": payload.invoice_id,
        "provider": provider,
        "provider_ref": provider_ref,
        "status": "created",
        "amount_cop": int(inv.get("amount_cop", 0)),
        "currency": "COP",
        "payment_link": payment_link,
        "raw_event": None,
        "created_at": datetime.now(timezone.utc),
        "confirmed_at": None,
    }
    # para mapeo por referencia
    doc["raw_event"] = {"reference": payload.invoice_id, "created_by_user_id": user.get("_id")}
    mongo.db.payments.insert_one(doc)

    log.info(
        "payment_created",
        payment_id=payment_id,
        invoice_id=payload.invoice_id,
        provider=provider,
        provider_ref=provider_ref,
    )

    return PaymentCreated(
        payment_id=payment_id,
        invoice_id=payload.invoice_id,
        provider=provider,
        amount_cop=doc["amount_cop"],
        payment_link=payment_link,
    )


@app.get("/payments/{payment_id}", response_model=PaymentPublic)
def get_payment(payment_id: str, request: Request):
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")
    user = _require_user(request)

    p = mongo.db.payments.find_one({"_id": payment_id})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Ownership: resident can only view payments for their invoices
    if user.get("role") == "resident":
        inv = mongo.db.invoices.find_one({"_id": p.get("invoice_id")})
        unit = mongo.db.units.find_one({"_id": (inv or {}).get("unit_id")}) if inv else None
        if not unit or unit.get("resident_user_id") != user.get("_id"):
            raise HTTPException(status_code=403, detail="Not allowed")

    return PaymentPublic(**p)


def _require_user(request: Request) -> dict:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = mongo.db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@app.post("/webhooks/{provider}")
def webhook(provider: str, event: WebhookEvent):
    """
    Ejemplo de webhook. En producción se valida firma (HMAC) según proveedor.
    Aquí se procesa un evento normalizado y se marca la factura como Pagada.
    """
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")

    provider = provider.lower()
    payment = mongo.db.payments.find_one({"_id": event.provider_ref}) or mongo.db.payments.find_one(
        {"provider": provider, "provider_ref": event.provider_ref}
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    if event.status.lower() in {"approved", "paid", "success", "confirmed"}:
        now = datetime.now(timezone.utc)
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "confirmed", "confirmed_at": now, "raw_event": event.raw}},
        )
        mongo.db.invoices.update_one(
            {"_id": payment["invoice_id"]},
            {"$set": {"status": "Pagada", "paid_at": now}},
        )
        log.info("payment_confirmed", payment_id=str(payment["_id"]), invoice_id=payment["invoice_id"])
    else:
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "failed", "raw_event": event.raw}},
        )
        log.info("payment_failed", payment_id=str(payment["_id"]), invoice_id=payment["invoice_id"])

    return {"ok": True}


@app.post("/webhooks/wompi")
async def wompi_webhook(request: Request):
    """
    Webhook real Wompi (Colombia).
    Valida firma SHA256 según `signature.properties` + `timestamp` + secret (WOMPI_WEBHOOK_SECRET).
    """
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")
    body = await request.json()

    if not _verify_wompi_event(body, request.headers.get("X-Event-Checksum")):
        raise HTTPException(status_code=401, detail="Invalid wompi signature")

    event_name = body.get("event")
    data = body.get("data") or {}
    tx = data.get("transaction") or {}
    status = str(tx.get("status") or "").upper()
    payment_link_id = tx.get("payment_link_id") or tx.get("payment_link") or None
    reference = tx.get("reference") or None

    # Try to find our payment by provider_ref (payment_link_id), else by reference/sku stored in raw_event.
    payment = None
    if payment_link_id:
        payment = mongo.db.payments.find_one({"provider": "wompi", "provider_ref": str(payment_link_id)})
    if not payment and reference:
        payment = mongo.db.payments.find_one({"provider": "wompi", "raw_event.reference": str(reference)})

    if not payment:
        # Don't fail webhook retries if we can't map; just log.
        log.warning("wompi_event_unmapped", event=event_name, payment_link_id=payment_link_id, reference=reference)
        return {"ok": True}

    now = datetime.now(timezone.utc)
    mongo.db.payments.update_one(
        {"_id": payment["_id"]},
        {"$set": {"raw_event": body, "provider_ref": payment.get("provider_ref") or payment_link_id}},
    )

    if status in {"APPROVED"}:
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "confirmed", "confirmed_at": now}},
        )
        mongo.db.invoices.update_one(
            {"_id": payment["invoice_id"]},
            {"$set": {"status": "Pagada", "paid_at": now}},
        )
        log.info("wompi_payment_approved", payment_id=str(payment["_id"]), invoice_id=payment["invoice_id"])
    elif status in {"DECLINED", "ERROR", "VOIDED"}:
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "failed"}},
        )
        log.info("wompi_payment_failed", payment_id=str(payment["_id"]), invoice_id=payment["invoice_id"], status=status)
    else:
        log.info("wompi_payment_pending", payment_id=str(payment["_id"]), invoice_id=payment["invoice_id"], status=status)

    return {"ok": True}


@app.post("/mock/confirm/{payment_id}")
def mock_confirm(payment_id: str):
    """
    Helper de dev: simula confirmación sin proveedor externo.
    """
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")

    payment = mongo.db.payments.find_one({"_id": payment_id})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    now = datetime.now(timezone.utc)
    mongo.db.payments.update_one(
        {"_id": payment_id},
        {"$set": {"status": "confirmed", "confirmed_at": now, "raw_event": {"mock": True}}},
    )
    mongo.db.invoices.update_one(
        {"_id": payment["invoice_id"]},
        {"$set": {"status": "Pagada", "paid_at": now}},
    )
    return {"ok": True}


@app.post("/demo/confirm/{payment_id}")
def demo_confirm(payment_id: str):
    """
    Helper de demo (solo dev): confirma un pago y marca la factura como Pagada
    sin esperar webhooks reales.
    """
    if settings.app_env != "dev":
        raise HTTPException(status_code=404, detail="Not found")
    return mock_confirm(payment_id)


@app.post("/webhooks/epayco/confirmation")
async def epayco_confirmation(request: Request):
    """
    URL de confirmación ePayco (server-to-server).
    Valida x_signature y actualiza estado de factura.
    """
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")

    form = await request.form()
    data = {k: str(v) for k, v in form.items()}

    x_signature = data.get("x_signature") or ""
    x_ref_payco = data.get("x_ref_payco") or ""
    x_transaction_id = data.get("x_transaction_id") or ""
    x_amount = data.get("x_amount") or data.get("x_amount_ok") or ""
    x_currency_code = data.get("x_currency_code") or "COP"
    x_response = data.get("x_response") or ""

    if not _verify_epayco_signature(
        x_signature=x_signature,
        x_ref_payco=x_ref_payco,
        x_transaction_id=x_transaction_id,
        x_amount=x_amount,
        x_currency_code=x_currency_code,
    ):
        raise HTTPException(status_code=401, detail="Invalid epayco signature")

    # Intentar mapear a factura usando invoice id en x_extra1 o factura
    invoice_id = data.get("x_extra1") or data.get("x_id_invoice") or data.get("factura") or data.get("invoice") or ""
    payment = None
    if x_ref_payco:
        payment = mongo.db.payments.find_one({"provider": "epayco", "provider_ref": x_ref_payco})
    if not payment and invoice_id:
        payment = mongo.db.payments.find_one({"provider": "epayco", "invoice_id": invoice_id})

    if not payment:
        log.warning("epayco_event_unmapped", x_ref_payco=x_ref_payco, invoice_id=invoice_id)
        return {"ok": True}

    now = datetime.now(timezone.utc)
    mongo.db.payments.update_one(
        {"_id": payment["_id"]},
        {"$set": {"raw_event": data, "provider_ref": x_ref_payco}},
    )

    if x_response.lower() == "aceptada":
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "confirmed", "confirmed_at": now}},
        )
        mongo.db.invoices.update_one(
            {"_id": payment["invoice_id"]},
            {"$set": {"status": "Pagada", "paid_at": now}},
        )
    elif x_response.lower() in {"rechazada", "fallida"}:
        mongo.db.payments.update_one({"_id": payment["_id"]}, {"$set": {"status": "failed"}})

    return {"ok": True}


def _create_wompi_payment_link(*, invoice_id: str, amount_cop: int, origin: str) -> tuple[str, str]:
    if not settings.wompi_private_key:
        raise HTTPException(status_code=400, detail="WOMPI_PRIVATE_KEY not configured")

    amount_in_cents = int(amount_cop) * 100
    payload = {
        "name": f"Administración - {invoice_id}",
        "description": "Pago administración conjunto residencial",
        "single_use": True,
        "collect_shipping": False,
        "currency": "COP",
        "amount_in_cents": amount_in_cents,
        "redirect_url": origin,
        "sku": invoice_id,
        "customer_data": {
            "customer_references": [
                {"label": "Invoice ID", "is_required": True},
            ]
        },
    }

    headers = {"Authorization": f"Bearer {settings.wompi_private_key}", "Content-Type": "application/json"}
    try:
        r = httpx.post(f"{settings.wompi_base_url.rstrip('/')}/payment_links", json=payload, headers=headers, timeout=20)
        r.raise_for_status()
        data = r.json().get("data") or r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Wompi error: {str(e)}")

    payment_link_id = str(data.get("id"))
    checkout_url = data.get("url") or f"https://checkout.wompi.co/l/{payment_link_id}"
    return checkout_url, payment_link_id


def _create_epayco_session(*, invoice_id: str, amount_cop: int) -> tuple[str, str]:
    """
    Crea sesión Smart Checkout en ePayco (Apify) y devuelve un "payment_link" especial:
    `epayco_session:<sessionId>`
    """
    if not (settings.epayco_public_key and settings.epayco_private_key):
        raise HTTPException(status_code=400, detail="EPAYCO_PUBLIC_KEY/EPAYCO_PRIVATE_KEY not configured")
    if not settings.epayco_confirmation_url:
        raise HTTPException(status_code=400, detail="EPAYCO_CONFIRMATION_URL not configured (must be public https)")

    basic = base64.b64encode(f"{settings.epayco_public_key}:{settings.epayco_private_key}".encode("utf-8")).decode("ascii")
    login_headers = {"Content-Type": "application/json", "Authorization": f"Basic {basic}"}
    base = settings.epayco_apify_base_url.rstrip("/")
    try:
        r = httpx.post(f"{base}/login", headers=login_headers, json={}, timeout=20)
        r.raise_for_status()
        token = r.json().get("token")
        if not token:
            raise RuntimeError("No token in epayco login response")

        session_headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
        payload = {
            "checkout_version": "2",
            "name": f"Administración {invoice_id}",
            "description": "Pago de administración",
            "currency": "COP",
            "amount": float(amount_cop),
            "invoice": invoice_id,
            "confirmation": settings.epayco_confirmation_url,
            "method": "POST",
            "lang": "ES",
            "extras": {"extra1": invoice_id},
        }
        s = httpx.post(f"{base}/payment/session/create", headers=session_headers, json=payload, timeout=20)
        s.raise_for_status()
        j = s.json()
        session_id = (j.get("data") or {}).get("sessionId")
        if not session_id:
            raise RuntimeError("No sessionId in epayco session response")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ePayco error: {str(e)}")

    return f"epayco_session:{session_id}", str(session_id)


def _verify_epayco_signature(
    *,
    x_signature: str,
    x_ref_payco: str,
    x_transaction_id: str,
    x_amount: str,
    x_currency_code: str,
) -> bool:
    if not (settings.epayco_p_cust_id_cliente and settings.epayco_p_key):
        return False
    raw = f"{settings.epayco_p_cust_id_cliente}^{settings.epayco_p_key}^{x_ref_payco}^{x_transaction_id}^{x_amount}^{x_currency_code}"
    computed = hashlib.sha256(raw.encode("utf-8")).hexdigest().lower()
    return hmac.compare_digest(computed, (x_signature or "").lower())


def _deep_get(obj: dict, path: str):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _verify_wompi_event(body: dict, header_checksum: str | None) -> bool:
    secret = settings.wompi_webhook_secret or ""
    if not secret:
        return False

    sig = body.get("signature") or {}
    props = sig.get("properties") or []
    timestamp = body.get("timestamp")
    provided = (header_checksum or sig.get("checksum") or "").strip().lower()
    if not provided or not timestamp or not isinstance(props, list):
        return False

    values: list[str] = []
    for p in props:
        v = _deep_get(body.get("data") or {}, str(p))
        values.append("" if v is None else str(v))

    raw = "".join(values) + str(timestamp) + secret
    computed = hashlib.sha256(raw.encode("utf-8")).hexdigest().lower()
    return hmac.compare_digest(computed, provided)

