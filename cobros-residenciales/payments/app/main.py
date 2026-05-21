from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx
import structlog
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


def _queue_factus_emit(kind: str, target_id: str) -> None:
    """Tras pagar reserva o gimnasio, encola emisión electrónica en el worker."""
    if kind not in {"reservation", "gym_subscription", "invoice"}:
        return
    url = f"{settings.backend_url.rstrip('/')}/billing/queue-emit"
    headers: dict[str, str] = {}
    if settings.internal_api_key:
        headers["X-Internal-Key"] = settings.internal_api_key
    try:
        with httpx.Client(timeout=8) as client:
            client.post(url, json={"target_kind": kind, "target_id": target_id}, headers=headers)
    except Exception as exc:
        log.warning("queue_factus_emit_failed", target_kind=kind, target_id=target_id, error=str(exc))


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
    _queue_factus_emit(kind, target_id)


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

    provider = "mock"
    payment_id = f"pay_{provider}_{int(datetime.now(timezone.utc).timestamp())}_{target_id[:8]}"

    origin = request.headers.get("origin") or "http://localhost:5173"
    payment_link = f"{origin}/mock-pay?payment_id={payment_id}"

    doc = {
        "_id": payment_id,
        "invoice_id": target_id if target_kind == "invoice" else None,
        "target_kind": target_kind,
        "target_id": target_id,
        "provider": provider,
        "provider_ref": None,
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
    Webhook genérico (mock / integraciones futuras).
    Procesa un evento normalizado y marca el destino como Pagado.
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


@app.post("/mock/confirm/{payment_id}")
def mock_confirm(payment_id: str):
    """Confirma un pago y marca el destino como Pagado (API interna)."""
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
    """Alias de demo para confirmar pagos sin pasarela externa."""
    if settings.app_env != "dev":
        raise HTTPException(status_code=404, detail="Not found")
    return mock_confirm(payment_id)
