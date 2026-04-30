from __future__ import annotations

from datetime import datetime, timezone

from celery import shared_task
import structlog

from app.config import settings
from app.factus_client import FactusClient
from app.mongo import connect_mongo, disconnect_mongo, mongo


log = structlog.get_logger()


def _period_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def _due_date(dt: datetime) -> datetime:
    day = max(1, min(28, int(settings.invoice_due_day)))
    return datetime(dt.year, dt.month, day, 23, 59, 59, tzinfo=timezone.utc)


@shared_task(name="app.tasks.generate_monthly_invoices")
def generate_monthly_invoices() -> dict:
    """
    Tarea mensual:
    - Crea facturas (si no existen) para todas las unidades
    - Emite factura electrónica vía Factus (si está configurado)
    - Guarda IDs/URLs en MongoDB
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

            # Emisión Factus (si aplica) y aún no emitida
            if factus.enabled() and factus_token and doc and not doc.get("factus_invoice_id"):
                try:
                    resident_email = None
                    tax_profile = None
                    if unit.get("resident_user_id"):
                        u = mongo.db.users.find_one({"_id": unit.get("resident_user_id")})
                        resident_email = (u or {}).get("email")
                        tax_profile = (u or {}).get("tax_profile")

                    # Requisitos mínimos “legales” para emisión (evita demo incompleto)
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
                        mongo.db.invoices.update_one(
                            {"_id": doc["_id"]},
                            {"$set": {"factus_error": "missing_tax_profile_for_factus"}},
                        )
                        continue

                    res = _emit_factus(
                        factus,
                        access_token=factus_token,
                        invoice=doc,
                        unit=unit,
                        resident_email=resident_email,
                        tax_profile=tax_profile,
                    )
                    mongo.db.invoices.update_one(
                        {"_id": doc["_id"]},
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
                            }
                        },
                    )
                    emitted += 1
                except Exception as e:
                    log.error("factus_emit_failed", invoice_id=str(doc.get("_id")), error=str(e))
                    mongo.db.invoices.update_one({"_id": doc["_id"]}, {"$set": {"factus_error": str(e)[:300]}})

        log.info("monthly_invoices_done", period=period, created=created, skipped=skipped, emitted=emitted)
        return {"period": period, "created": created, "skipped_existing": skipped, "emitted": emitted}
    finally:
        disconnect_mongo()


@shared_task(name="app.tasks.emit_invoice")
def emit_invoice(invoice_id: str) -> dict:
    """
    Emite (o reintenta) una factura específica vía Factus.
    Usado por el admin desde el backend: POST /invoices/{id}/retry-factus
    """
    connect_mongo()
    try:
        if mongo.db is None:
            raise RuntimeError("DB not ready")

        inv = mongo.db.invoices.find_one({"_id": invoice_id})
        if not inv:
            return {"ok": False, "error": "invoice_not_found"}
        unit = mongo.db.units.find_one({"_id": inv.get("unit_id")}) or {}

        factus = FactusClient()
        if not factus.enabled():
            mongo.db.invoices.update_one({"_id": invoice_id}, {"$set": {"factus_error": "factus_not_configured"}})
            return {"ok": False, "error": "factus_not_configured"}

        token = _get_factus_token(factus)

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
        mongo.db.invoices.update_one(
            {"_id": invoice_id},
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
                }
            },
        )
        return {"ok": True}
    except Exception as e:
        mongo.db.invoices.update_one({"_id": invoice_id}, {"$set": {"factus_error": str(e)[:300]}})
        return {"ok": False, "error": str(e)}
    finally:
        disconnect_mongo()


def _get_factus_token(factus: FactusClient) -> str:
    import asyncio

    async def _run():
        return await factus.get_access_token()

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
        return {
            "factus_invoice_id": r.reference_code,
            "factus_number": r.number,
            "factus_cufe": r.cufe,
            "factus_public_url": r.public_url,
            "pdf_url": r.pdf_url,
            "xml_url": r.xml_url,
            "raw": r.raw,
        }

    return asyncio.run(_run())

