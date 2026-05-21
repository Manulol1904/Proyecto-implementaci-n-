from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from celery import shared_task
import httpx
import structlog

from app.config import settings
from app.factus_client import FactusClient
from app.mongo import connect_mongo, disconnect_mongo, mongo


log = structlog.get_logger()

PAID_STATUS = {
    "invoice": "Pagada",
    "reservation": "Pagada",
    "gym_subscription": "Pagada",
}


def _period_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def _previous_period(period: str) -> str:
    year, month = map(int, period.split("-"))
    if month == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{month - 1:02d}"


def _due_date(dt: datetime) -> datetime:
    day = max(1, min(28, int(settings.invoice_due_day)))
    return datetime(dt.year, dt.month, day, 23, 59, 59, tzinfo=timezone.utc)


def _automation_run(task: str, result: dict[str, Any]) -> None:
    if mongo.db is None:
        return
    mongo.db.automation_runs.insert_one(
        {
            "_id": f"{task}_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "task": task,
            "result": result,
            "created_at": datetime.now(timezone.utc),
        }
    )


def _payment_target(payment: dict) -> tuple[str, str]:
    kind = payment.get("target_kind") or "invoice"
    tid = payment.get("target_id") or payment.get("invoice_id") or ""
    return kind, tid


def _mark_target_paid(kind: str, target_id: str, paid_at: datetime) -> None:
    if mongo.db is None or not target_id:
        return
    new_status = PAID_STATUS.get(kind, "Pagada")
    if kind == "invoice":
        mongo.db.invoices.update_one({"_id": target_id}, {"$set": {"status": new_status, "paid_at": paid_at}})
    elif kind == "reservation":
        mongo.db.reservations.update_one({"_id": target_id}, {"$set": {"status": new_status, "paid_at": paid_at}})
    elif kind == "gym_subscription":
        mongo.db.gym_subscriptions.update_one({"_id": target_id}, {"$set": {"status": new_status, "paid_at": paid_at}})


@shared_task(name="app.tasks.generate_monthly_invoices")
def generate_monthly_invoices() -> dict:
    """
    Tarea mensual:
    - Crea facturas (si no existen) para todas las unidades.
    - Emite factura electrónica vía Factus (si está configurado).
    - Guarda IDs/URLs en MongoDB.
    """
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")

        now = datetime.now(timezone.utc)
        period = _period_key(now)
        due_date = _due_date(now)

        factus = FactusClient()
        factus_token: str | None = None
        if factus.enabled():
            try:
                factus_token = _get_factus_token(factus)
            except Exception as e:
                log.error("factus_auth_failed", error=str(e))

        created = 0
        skipped = 0
        emitted = 0
        for unit in mongo.db.units.find({}):
            amount = int(round(settings.admin_fee_base_cop * float(unit["coefficient"])))
            doc = {
                "_id": f"inv_{period}_{unit['_id']}",
                "unit_id": unit["_id"],
                "period": period,
                "base_fee_cop": int(settings.admin_fee_base_cop),
                "coefficient": float(unit["coefficient"]),
                "amount_cop": amount,
                "due_date": due_date,
                "status": "Pendiente",
                "factus_invoice_id": None,
                "pdf_url": None,
                "xml_url": None,
                "created_at": now,
                "paid_at": None,
            }

            try:
                mongo.db.invoices.insert_one(doc)
                created += 1
            except Exception:
                skipped += 1
                existing = mongo.db.invoices.find_one({"unit_id": unit["_id"], "period": period}) or {}
                doc = existing

            if factus.enabled() and factus_token and doc and not doc.get("factus_invoice_id"):
                ok = _emit_invoice_connected(doc["_id"], factus=factus, token=factus_token)
                if ok.get("ok"):
                    emitted += 1

        result = {"period": period, "created": created, "skipped_existing": skipped, "emitted": emitted}
        log.info("monthly_invoices_done", **result)
        _automation_run("generate_monthly_invoices", result)
        return result
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.mark_overdue_invoices")
def mark_overdue_invoices() -> dict:
    """Marca como Vencida toda factura pendiente con fecha de vencimiento pasada."""
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        now = datetime.now(timezone.utc)
        res = mongo.db.invoices.update_many(
            {"status": "Pendiente", "due_date": {"$lt": now}},
            {"$set": {"status": "Vencida", "overdue_marked_at": now}},
        )
        result = {"marked": int(res.modified_count)}
        log.info("overdue_invoices_marked", **result)
        _automation_run("mark_overdue_invoices", result)
        return result
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.create_monthly_gym_subscriptions")
def create_monthly_gym_subscriptions() -> dict:
    """
    Renueva automáticamente gimnasio:
    si un usuario pagó el periodo anterior, se crea la suscripción pendiente del periodo actual.
    """
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        now = datetime.now(timezone.utc)
        period = _period_key(now)
        prev = _previous_period(period)
        created = 0
        skipped = 0
        for prev_sub in mongo.db.gym_subscriptions.find({"period": prev, "status": "Pagada"}):
            user_id = prev_sub.get("user_id")
            if not user_id:
                continue
            sub_id = f"gym_{period}_{user_id}"
            doc = {
                "_id": sub_id,
                "user_id": user_id,
                "period": period,
                "amount_cop": int(settings.gym_monthly_cop),
                "status": "Pendiente",
                "created_at": now,
                "paid_at": None,
                "auto_created_from_period": prev,
            }
            try:
                mongo.db.gym_subscriptions.insert_one(doc)
                created += 1
            except Exception:
                skipped += 1
        result = {"period": period, "previous_period": prev, "created": created, "skipped_existing": skipped}
        log.info("monthly_gym_subscriptions_done", **result)
        _automation_run("create_monthly_gym_subscriptions", result)
        return result
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.cancel_stale_pending_reservations")
def cancel_stale_pending_reservations() -> dict:
    """Cancela reservas pendientes sin pago después de la ventana configurada."""
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=max(1, int(settings.reservation_pending_expire_minutes)))
        res = mongo.db.reservations.update_many(
            {"status": "Pendiente", "paid_at": None, "created_at": {"$lt": cutoff}},
            {
                "$set": {
                    "status": "Cancelada",
                    "canceled_at": now,
                    "cancel_reason": "auto_expired_unpaid_reservation",
                }
            },
        )
        result = {"expired": int(res.modified_count), "cutoff": cutoff.isoformat()}
        log.info("stale_pending_reservations_cancelled", **result)
        _automation_run("cancel_stale_pending_reservations", result)
        return result
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.retry_factus_errors")
def retry_factus_errors() -> dict:
    """Reintenta emisión Factus para errores transitorios, evitando perfiles fiscales incompletos."""
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        factus = FactusClient()
        if not factus.enabled():
            result = {"attempted": 0, "emitted": 0, "skipped": "factus_not_configured"}
            _automation_run("retry_factus_errors", result)
            return result
        token = _get_factus_token(factus)
        query = {
            "factus_invoice_id": {"$in": [None, ""]},
            "factus_error": {"$nin": [None, "", "missing_tax_profile_for_factus", "factus_not_configured"]},
        }
        attempted = 0
        emitted = 0
        limit = max(1, int(settings.factus_retry_limit))
        for inv in mongo.db.invoices.find(query).limit(limit):
            attempted += 1
            result = _emit_invoice_connected(inv["_id"], factus=factus, token=token)
            if result.get("ok"):
                emitted += 1
        paid_query = {**query, "status": "Pagada"}
        for res in mongo.db.reservations.find(paid_query).limit(limit):
            attempted += 1
            result = _emit_reservation_connected(res["_id"], factus=factus, token=token)
            if result.get("ok"):
                emitted += 1
        for sub in mongo.db.gym_subscriptions.find(paid_query).limit(limit):
            attempted += 1
            result = _emit_gym_subscription_connected(sub["_id"], factus=factus, token=token)
            if result.get("ok"):
                emitted += 1
        out = {"attempted": attempted, "emitted": emitted}
        log.info("factus_retry_done", **out)
        _automation_run("retry_factus_errors", out)
        return out
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.health_check")
def health_check() -> dict:
    """Registra salud de Mongo, backend y payments en `system_health_checks`."""
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        now = datetime.now(timezone.utc)
        status: dict[str, Any] = {"mongo": "ok", "backend": "unknown", "payments": "unknown"}
        try:
            status["users_count"] = mongo.db.users.estimated_document_count()
        except Exception as e:
            status["mongo"] = f"fail: {str(e)[:120]}"

        for name, url in {
            "backend": settings.backend_internal_url.rstrip("/") + "/health",
            "payments": settings.payments_internal_url.rstrip("/") + "/health",
        }.items():
            try:
                r = httpx.get(url, timeout=5)
                status[name] = "ok" if 200 <= r.status_code < 300 else f"fail:{r.status_code}"
            except Exception as e:
                status[name] = f"fail: {str(e)[:120]}"

        doc = {"_id": f"health_{int(now.timestamp() * 1000)}", "created_at": now, **status}
        mongo.db.system_health_checks.insert_one(doc)
        log.info("health_check_done", **status)
        return status
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.reconcile_mock_payments")
def reconcile_mock_payments() -> dict:
    """
    En dev/demo confirma pagos mock que quedaron `created` por caída de UI/HMR.
    No se ejecuta en prod para evitar marcar pagos sin confirmación real.
    """
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        if settings.app_env != "dev":
            result = {"confirmed": 0, "skipped": "not_dev"}
            _automation_run("reconcile_mock_payments", result)
            return result
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=max(1, int(settings.payment_reconcile_after_minutes)))
        confirmed = 0
        for payment in mongo.db.payments.find({"provider": "mock", "status": "created", "created_at": {"$lt": cutoff}}).limit(50):
            kind, tid = _payment_target(payment)
            mongo.db.payments.update_one(
                {"_id": payment["_id"]},
                {"$set": {"status": "confirmed", "confirmed_at": now, "raw_event.auto_reconciled": True}},
            )
            _mark_target_paid(kind, tid, now)
            confirmed += 1
        result = {"confirmed": confirmed, "cutoff": cutoff.isoformat()}
        log.info("mock_payments_reconciled", **result)
        _automation_run("reconcile_mock_payments", result)
        return result
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.precompute_metrics")
def precompute_metrics() -> dict:
    """Precalcula métricas operativas para dashboards/reportes rápidos."""
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        now = datetime.now(timezone.utc)
        period = _period_key(now)

        def _sum(collection, match: dict, field: str = "amount_cop") -> int:
            rows = list(mongo.db[collection].aggregate([{"$match": match}, {"$group": {"_id": None, "s": {"$sum": f"${field}"}}}]))
            return int((rows[0]["s"] if rows else 0) or 0)

        metrics = {
            "kind": "dashboard",
            "period": period,
            "generated_at": now,
            "invoices": {
                "pendientes": mongo.db.invoices.count_documents({"status": "Pendiente"}),
                "vencidas": mongo.db.invoices.count_documents({"status": "Vencida"}),
                "pagadas": mongo.db.invoices.count_documents({"status": "Pagada"}),
                "total_recaudado_cop": _sum("invoices", {"status": "Pagada"}),
                "total_vencido_cop": _sum("invoices", {"status": "Vencida"}),
            },
            "reservations": {
                "pendientes": mongo.db.reservations.count_documents({"status": "Pendiente"}),
                "pagadas": mongo.db.reservations.count_documents({"status": "Pagada"}),
                "canceladas": mongo.db.reservations.count_documents({"status": "Cancelada"}),
                "recaudado_cop": _sum("reservations", {"status": "Pagada"}),
            },
            "gym": {
                "period": period,
                "pendientes": mongo.db.gym_subscriptions.count_documents({"period": period, "status": "Pendiente"}),
                "pagadas": mongo.db.gym_subscriptions.count_documents({"period": period, "status": "Pagada"}),
                "recaudado_cop": _sum("gym_subscriptions", {"period": period, "status": "Pagada"}),
            },
        }
        mongo.db.metrics.update_one(
            {"kind": "dashboard", "period": period},
            {"$set": metrics, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        result = {"period": period, "updated": True}
        log.info("metrics_precomputed", **result)
        _automation_run("precompute_metrics", result)
        return result
    finally:
        disconnect_mongo()


def _apply_factus_result(collection: str, doc_id: str, res: dict) -> None:
    if mongo.db is None:
        return
    mongo.db[collection].update_one(
        {"_id": doc_id},
        {
            "$set": {
                "factus_invoice_id": res["factus_invoice_id"],
                "factus_number": res.get("factus_number"),
                "factus_cufe": res.get("factus_cufe"),
                "factus_public_url": res.get("factus_public_url"),
                "pdf_url": res["pdf_url"],
                "xml_url": res["xml_url"],
                "factus_raw": res.get("raw"),
                "factus_error": None,
                "factus_last_retry_at": datetime.now(timezone.utc),
            }
        },
    )


def _set_factus_error(collection: str, doc_id: str, error: str) -> None:
    if mongo.db is None:
        return
    mongo.db[collection].update_one(
        {"_id": doc_id},
        {"$set": {"factus_error": error[:300], "factus_last_retry_at": datetime.now(timezone.utc)}},
    )


def _tax_profile_for_user(user_id: str | None) -> tuple[str | None, dict | None]:
    if not user_id or mongo.db is None:
        return None, None
    u = mongo.db.users.find_one({"_id": user_id}) or {}
    return u.get("email"), u.get("tax_profile")


def _require_tax_profile(tax_profile: dict | None) -> bool:
    required = [
        "identification_document_id",
        "identification",
        "names",
        "address",
        "email",
        "phone",
        "municipality_id",
    ]
    return bool(tax_profile) and not any(tax_profile.get(k) in (None, "", 0) for k in required)


@shared_task(name="app.tasks.emit_billing_document")
def emit_billing_document(target_kind: str, target_id: str) -> dict:
    """Emite Factus para administración, reserva (parqueadero/salón) o gimnasio."""
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")
        factus = FactusClient()
        if not factus.enabled():
            coll = {"invoice": "invoices", "reservation": "reservations", "gym_subscription": "gym_subscriptions"}.get(
                target_kind
            )
            if coll:
                _set_factus_error(coll, target_id, "factus_not_configured")
            return {"ok": False, "error": "factus_not_configured"}
        token = _get_factus_token(factus)
        if target_kind == "invoice":
            return _emit_invoice_connected(target_id, factus=factus, token=token)
        if target_kind == "reservation":
            return _emit_reservation_connected(target_id, factus=factus, token=token)
        if target_kind == "gym_subscription":
            return _emit_gym_subscription_connected(target_id, factus=factus, token=token)
        return {"ok": False, "error": f"unsupported_kind:{target_kind}"}
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.emit_invoice")
def emit_invoice(invoice_id: str) -> dict:
    """Compat: emisión de cuota de administración."""
    return emit_billing_document("invoice", invoice_id)


def _emit_invoice_connected(invoice_id: str, *, factus: FactusClient, token: str) -> dict:
    if mongo.db is None:
        raise RuntimeError("DB not ready")
    try:
        inv = mongo.db.invoices.find_one({"_id": invoice_id})
        if not inv:
            return {"ok": False, "error": "invoice_not_found"}
        unit = mongo.db.units.find_one({"_id": inv.get("unit_id")}) or {}

        resident_email = None
        tax_profile = None
        if unit.get("resident_user_id"):
            u = mongo.db.users.find_one({"_id": unit.get("resident_user_id")}) or {}
            resident_email = u.get("email")
            tax_profile = u.get("tax_profile")

        required = [
            "identification_document_id",
            "identification",
            "names",
            "address",
            "email",
            "phone",
            "municipality_id",
        ]
        if not tax_profile or any(tax_profile.get(k) in (None, "", 0) for k in required):
            mongo.db.invoices.update_one({"_id": invoice_id}, {"$set": {"factus_error": "missing_tax_profile_for_factus"}})
            return {"ok": False, "error": "missing_tax_profile_for_factus"}

        res = _emit_factus(
            factus,
            access_token=token,
            invoice=inv,
            unit=unit,
            resident_email=resident_email,
            tax_profile=tax_profile,
        )
        _apply_factus_result("invoices", invoice_id, res)
        return {"ok": True}
    except Exception as e:
        _set_factus_error("invoices", invoice_id, str(e))
        return {"ok": False, "error": str(e)}


def _emit_reservation_connected(reservation_id: str, *, factus: FactusClient, token: str) -> dict:
    if mongo.db is None:
        raise RuntimeError("DB not ready")
    try:
        res_doc = mongo.db.reservations.find_one({"_id": reservation_id})
        if not res_doc:
            return {"ok": False, "error": "reservation_not_found"}
        if res_doc.get("factus_number") or res_doc.get("factus_invoice_id"):
            return {"ok": True, "skipped": "already_emitted"}
        if res_doc.get("status") != "Pagada":
            return {"ok": False, "error": "reservation_not_paid"}

        email, tax_profile = _tax_profile_for_user(res_doc.get("user_id"))
        if not _require_tax_profile(tax_profile):
            _set_factus_error("reservations", reservation_id, "missing_tax_profile_for_factus")
            return {"ok": False, "error": "missing_tax_profile_for_factus"}

        code = res_doc.get("amenity_code", "RES")
        atype = res_doc.get("amenity_type", "")
        start = res_doc.get("start_at")
        start_s = start.strftime("%Y-%m-%d") if hasattr(start, "strftime") else str(start)[:10]
        if atype == "visitor_parking":
            prefix, item_name = "PKG", f"Parqueadero visitante {code} {start_s}"
        else:
            prefix, item_name = "SAL", f"Salón comunal {code} {start_s}"
        reference_code = f"{prefix}-{code}-{reservation_id[:8]}"

        result = _emit_service_factus(
            factus,
            access_token=token,
            reference_code=reference_code,
            item_code=f"{prefix}-{code}",
            item_name=item_name,
            amount_cop=int(res_doc["amount_cop"]),
            resident_email=email,
            tax_profile=tax_profile,
        )
        _apply_factus_result("reservations", reservation_id, result)
        return {"ok": True}
    except Exception as e:
        _set_factus_error("reservations", reservation_id, str(e))
        return {"ok": False, "error": str(e)}


def _emit_gym_subscription_connected(sub_id: str, *, factus: FactusClient, token: str) -> dict:
    if mongo.db is None:
        raise RuntimeError("DB not ready")
    try:
        sub = mongo.db.gym_subscriptions.find_one({"_id": sub_id})
        if not sub:
            return {"ok": False, "error": "subscription_not_found"}
        if sub.get("factus_number") or sub.get("factus_invoice_id"):
            return {"ok": True, "skipped": "already_emitted"}
        if sub.get("status") != "Pagada":
            return {"ok": False, "error": "subscription_not_paid"}

        email, tax_profile = _tax_profile_for_user(sub.get("user_id"))
        if not _require_tax_profile(tax_profile):
            _set_factus_error("gym_subscriptions", sub_id, "missing_tax_profile_for_factus")
            return {"ok": False, "error": "missing_tax_profile_for_factus"}

        period = sub.get("period", "")
        reference_code = f"GYM-{period}-{sub_id[:8]}"
        result = _emit_service_factus(
            factus,
            access_token=token,
            reference_code=reference_code,
            item_code=f"GYM-{period}",
            item_name=f"Suscripción gimnasio {period}",
            amount_cop=int(sub["amount_cop"]),
            resident_email=email,
            tax_profile=tax_profile,
        )
        _apply_factus_result("gym_subscriptions", sub_id, result)
        return {"ok": True}
    except Exception as e:
        _set_factus_error("gym_subscriptions", sub_id, str(e))
        return {"ok": False, "error": str(e)}


def _get_factus_token(factus: FactusClient) -> str:
    import asyncio

    async def _run():
        return await factus.get_access_token()

    return asyncio.run(_run())


def _factus_result_from_bill(r) -> dict:
    return {
        "factus_invoice_id": r.reference_code,
        "factus_number": r.number,
        "factus_cufe": r.cufe,
        "factus_public_url": r.public_url,
        "pdf_url": r.pdf_url,
        "xml_url": r.xml_url,
        "raw": r.raw,
    }


def _emit_service_factus(
    factus: FactusClient,
    *,
    access_token: str,
    reference_code: str,
    item_code: str,
    item_name: str,
    amount_cop: int,
    resident_email: str | None,
    tax_profile: dict | None,
) -> dict:
    import asyncio

    async def _run():
        r = await factus.validate_service_bill(
            access_token=access_token,
            reference_code=reference_code,
            item_code=item_code,
            item_name=item_name,
            amount_cop=amount_cop,
            resident_email=resident_email,
            tax_profile=tax_profile,
        )
        return _factus_result_from_bill(r)

    return asyncio.run(_run())


def _emit_factus(
    factus: FactusClient,
    *,
    access_token: str,
    invoice: dict,
    unit: dict,
    resident_email: str | None,
    tax_profile: dict | None,
) -> dict:
    import asyncio

    async def _run():
        r = await factus.validate_bill(
            access_token=access_token,
            invoice=invoice,
            unit=unit,
            resident_email=resident_email,
            tax_profile=tax_profile,
        )
        return _factus_result_from_bill(r)

    return asyncio.run(_run())
