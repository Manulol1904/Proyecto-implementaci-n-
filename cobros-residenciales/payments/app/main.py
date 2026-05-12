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


PAID_STATUS = {
    "invoice": "Pagada",
    "reservation": "Pagada",
    "gym_subscription": "Pagada",
}


def _resolve_target(kind: str, target_id: str, user: dict) -> dict:
    """
    Resuelve el documento destino del pago: amount_cop, current_status y doc.
    Aplica ownership según rol.
    """
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")

    if kind == "invoice":
        inv = mongo.db.invoices.find_one({"_id": target_id})
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if inv.get("status") == "Pagada":
            raise HTTPException(status_code=400, detail="Invoice already paid")
        if user.get("role") == "resident":
            unit = mongo.db.units.find_one({"_id": inv.get("unit_id")})
            if not unit or unit.get("resident_user_id") != user.get("_id"):
                raise HTTPException(status_code=403, detail="Not allowed to pay this invoice")
        return {"amount_cop": int(inv.get("amount_cop", 0)), "current_status": inv.get("status"), "doc": inv}

    if kind == "reservation":
        r = mongo.db.reservations.find_one({"_id": target_id})
        if not r:
            raise HTTPException(status_code=404, detail="Reservation not found")
        if r.get("status") == "Pagada":
            raise HTTPException(status_code=400, detail="Reservation already paid")
        if r.get("status") == "Cancelada":
            raise HTTPException(status_code=400, detail="Reservation is canceled")
        if user.get("role") == "resident" and r.get("user_id") != user.get("_id"):
            raise HTTPException(status_code=403, detail="Not allowed to pay this reservation")
        return {"amount_cop": int(r.get("amount_cop", 0)), "current_status": r.get("status"), "doc": r}

    if kind == "gym_subscription":
        s = mongo.db.gym_subscriptions.find_one({"_id": target_id})
        if not s:
            raise HTTPException(status_code=404, detail="Subscription not found")
        if s.get("status") == "Pagada":
            raise HTTPException(status_code=400, detail="Subscription already paid")
        if user.get("role") == "resident" and s.get("user_id") != user.get("_id"):
            raise HTTPException(status_code=403, detail="Not allowed to pay this subscription")
        return {"amount_cop": int(s.get("amount_cop", 0)), "current_status": s.get("status"), "doc": s}

    raise HTTPException(status_code=400, detail=f"Unsupported target_kind: {kind}")


def _mark_target_paid(kind: str, target_id: str, paid_at: datetime) -> None:
    """Marca el documento destino como Pagado según su tipo."""
    if mongo.db is None:
        return
    new_status = PAID_STATUS.get(kind, "Pagada")
    if kind == "invoice":
        mongo.db.invoices.update_one(
            {"_id": target_id},
            {"$set": {"status": new_status, "paid_at": paid_at}},
        )
    elif kind == "reservation":
        mongo.db.reservations.update_one(
            {"_id": target_id},
            {"$set": {"status": new_status, "paid_at": paid_at}},
        )
    elif kind == "gym_subscription":
        mongo.db.gym_subscriptions.update_one(
            {"_id": target_id},
            {"$set": {"status": new_status, "paid_at": paid_at}},
        )


def _payment_target(payment: dict) -> tuple[str, str]:
    kind = payment.get("target_kind") or "invoice"
    tid = payment.get("target_id") or payment.get("invoice_id") or ""
    return kind, tid


@app.post("/payments", response_model=PaymentCreated)
def create_payment(payload: PaymentCreate, request: Request):
    if mongo.db is None:
        raise HTTPException(status_code=400, detail="DB not ready")

    user = _require_user(request)

    target_kind = payload.target_kind or "invoice"
    target_id = payload.target_id or payload.invoice_id or ""
    if not target_id:
        raise HTTPException(status_code=400, detail="Missing target_id/invoice_id")

    resolved = _resolve_target(target_kind, target_id, user)
    amount_cop = int(resolved["amount_cop"])

    # Provider is server-side configuration (avoid client spoofing).
    # In dev/demo we allow UI to choose provider for testing.
    requested = (payload.provider or "").lower().strip()
    if settings.app_env == "dev" and requested in {"mock", "wompi", "epayco"}:
        provider = requested
    else:
        provider = (settings.payments_provider or "mock").lower()
    payment_id = f"pay_{provider}_{int(datetime.now(timezone.utc).timestamp())}_{target_id[:8]}"

    origin = request.headers.get("origin") or "http://localhost:5173"

    payment_link: str
    provider_ref: str | None = None
    if provider == "wompi":
        payment_link, provider_ref = _create_wompi_payment_link(
            invoice_id=target_id,
            amount_cop=amount_cop,
            origin=origin,
        )
    elif provider == "epayco":
        payment_link, provider_ref = _create_epayco_session(
            invoice_id=target_id,
            amount_cop=amount_cop,
        )
    else:
        # En mock: el "payment link" solo apunta a un endpoint del mismo servicio para simular confirmación.
        payment_link = f"{origin}/mock-pay?payment_id={payment_id}"

    doc = {
        "_id": payment_id,
        "invoice_id": target_id if target_kind == "invoice" else None,
        "target_kind": target_kind,
        "target_id": target_id,
        "provider": provider,
        "provider_ref": provider_ref,
        "status": "created",
        "amount_cop": amount_cop,
        "currency": "COP",
        "payment_link": payment_link,
        "raw_event": {
            "reference": target_id,
            "target_kind": target_kind,
            "target_id": target_id,
            "created_by_user_id": user.get("_id"),
        },
        "created_at": datetime.now(timezone.utc),
        "confirmed_at": None,
    }
    mongo.db.payments.insert_one(doc)

    log.info(
        "payment_created",
        payment_id=payment_id,
        target_kind=target_kind,
        target_id=target_id,
        provider=provider,
        provider_ref=provider_ref,
    )

    return PaymentCreated(
        payment_id=payment_id,
        invoice_id=target_id if target_kind == "invoice" else None,
        target_kind=target_kind,
        target_id=target_id,
        provider=provider,
        amount_cop=amount_cop,
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

    # Ownership por target_kind
    if user.get("role") == "resident":
        kind, tid = _payment_target(p)
        owned = False
        if kind == "invoice":
            inv = mongo.db.invoices.find_one({"_id": tid})
            unit = mongo.db.units.find_one({"_id": (inv or {}).get("unit_id")}) if inv else None
            owned = bool(unit and unit.get("resident_user_id") == user.get("_id"))
        elif kind == "reservation":
            r = mongo.db.reservations.find_one({"_id": tid})
            owned = bool(r and r.get("user_id") == user.get("_id"))
        elif kind == "gym_subscription":
            s = mongo.db.gym_subscriptions.find_one({"_id": tid})
            owned = bool(s and s.get("user_id") == user.get("_id"))
        if not owned:
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

    kind, tid = _payment_target(payment)
    if event.status.lower() in {"approved", "paid", "success", "confirmed"}:
        now = datetime.now(timezone.utc)
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "confirmed", "confirmed_at": now, "raw_event": event.raw}},
        )
        _mark_target_paid(kind, tid, now)
        log.info("payment_confirmed", payment_id=str(payment["_id"]), target_kind=kind, target_id=tid)
    else:
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "failed", "raw_event": event.raw}},
        )
        log.info("payment_failed", payment_id=str(payment["_id"]), target_kind=kind, target_id=tid)

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

    kind, tid = _payment_target(payment)
    if status in {"APPROVED"}:
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "confirmed", "confirmed_at": now}},
        )
        _mark_target_paid(kind, tid, now)
        log.info("wompi_payment_approved", payment_id=str(payment["_id"]), target_kind=kind, target_id=tid)
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
    kind, tid = _payment_target(payment)
    _mark_target_paid(kind, tid, now)
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

    # Intentar mapear el pago: por provider_ref o por target_id (en x_extra1 puede venir invoice/reservation/sub).
    target_hint = data.get("x_extra1") or data.get("x_id_invoice") or data.get("factura") or data.get("invoice") or ""
    payment = None
    if x_ref_payco:
        payment = mongo.db.payments.find_one({"provider": "epayco", "provider_ref": x_ref_payco})
    if not payment and target_hint:
        payment = mongo.db.payments.find_one(
            {"provider": "epayco", "$or": [{"target_id": target_hint}, {"invoice_id": target_hint}]}
        )

    if not payment:
        log.warning("epayco_event_unmapped", x_ref_payco=x_ref_payco, invoice_id=invoice_id)
        return {"ok": True}

    now = datetime.now(timezone.utc)
    mongo.db.payments.update_one(
        {"_id": payment["_id"]},
        {"$set": {"raw_event": data, "provider_ref": x_ref_payco}},
    )

    kind, tid = _payment_target(payment)
    if x_response.lower() == "aceptada":
        mongo.db.payments.update_one(
            {"_id": payment["_id"]},
            {"$set": {"status": "confirmed", "confirmed_at": now}},
        )
        _mark_target_paid(kind, tid, now)
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

