from __future__ import annotations

from datetime import datetime

from app.core.errors import not_found
from app.db.mongo import mongo
from app.domain.billing import BillingDocumentItem, BillingKind
from app.domain.enums import AmenityType, UserRole

COLLECTION_BY_KIND: dict[BillingKind, str] = {
    "invoice": "invoices",
    "reservation": "reservations",
    "gym_subscription": "gym_subscriptions",
}


def _fmt_dt(dt: datetime | None) -> str:
    if not dt:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M")


def invoice_to_billing(doc: dict, unit_code: str | None) -> BillingDocumentItem:
    code = unit_code or doc.get("unit_id", "")[:8]
    return BillingDocumentItem(
        id=doc["_id"],
        kind="invoice",
        label=f"Administración {doc.get('period')} — {code}",
        category="Administración",
        period=doc.get("period"),
        amount_cop=int(doc.get("amount_cop", 0)),
        status=str(doc.get("status", "")),
        created_at=doc["created_at"],
        paid_at=doc.get("paid_at"),
        unit_code=code,
        factus_invoice_id=doc.get("factus_invoice_id"),
        factus_number=doc.get("factus_number"),
        factus_cufe=doc.get("factus_cufe"),
        factus_public_url=doc.get("factus_public_url"),
        factus_error=doc.get("factus_error"),
        pdf_url=doc.get("pdf_url"),
        xml_url=doc.get("xml_url"),
    )


def reservation_to_billing(doc: dict) -> BillingDocumentItem:
    atype = doc.get("amenity_type", "")
    code = doc.get("amenity_code", "")
    if atype == AmenityType.visitor_parking.value:
        category = "Parqueadero"
        label = f"Parqueadero {code} ({_fmt_dt(doc.get('start_at'))})"
    else:
        category = "Salón comunal"
        label = f"Salón {code} ({_fmt_dt(doc.get('start_at'))})"
    return BillingDocumentItem(
        id=doc["_id"],
        kind="reservation",
        label=label,
        category=category,
        period=None,
        amount_cop=int(doc.get("amount_cop", 0)),
        status=str(doc.get("status", "")),
        created_at=doc["created_at"],
        paid_at=doc.get("paid_at"),
        amenity_code=code,
        factus_invoice_id=doc.get("factus_invoice_id"),
        factus_number=doc.get("factus_number"),
        factus_cufe=doc.get("factus_cufe"),
        factus_public_url=doc.get("factus_public_url"),
        factus_error=doc.get("factus_error"),
        pdf_url=doc.get("pdf_url"),
        xml_url=doc.get("xml_url"),
    )


def gym_to_billing(doc: dict) -> BillingDocumentItem:
    period = doc.get("period", "")
    return BillingDocumentItem(
        id=doc["_id"],
        kind="gym_subscription",
        label=f"Gimnasio — {period}",
        category="Gimnasio",
        period=period,
        amount_cop=int(doc.get("amount_cop", 0)),
        status=str(doc.get("status", "")),
        created_at=doc["created_at"],
        paid_at=doc.get("paid_at"),
        factus_invoice_id=doc.get("factus_invoice_id"),
        factus_number=doc.get("factus_number"),
        factus_cufe=doc.get("factus_cufe"),
        factus_public_url=doc.get("factus_public_url"),
        factus_error=doc.get("factus_error"),
        pdf_url=doc.get("pdf_url"),
        xml_url=doc.get("xml_url"),
    )


async def billing_documents_for_user(user: dict, *, limit: int = 50) -> list[BillingDocumentItem]:
    if mongo.db is None:
        return []
    items: list[BillingDocumentItem] = []
    unit_codes: dict[str, str] = {}

    if user.get("role") == UserRole.admin.value:
        async for doc in mongo.db.invoices.find({}).sort([("created_at", -1)]).limit(limit):
            uid = doc.get("unit_id")
            if uid and uid not in unit_codes:
                u = await mongo.db.units.find_one({"_id": uid}, {"code": 1})
                unit_codes[uid] = (u or {}).get("code", uid[:8])
            items.append(invoice_to_billing(doc, unit_codes.get(uid)))
        async for doc in mongo.db.reservations.find({}).sort([("created_at", -1)]).limit(limit):
            items.append(reservation_to_billing(doc))
        async for doc in mongo.db.gym_subscriptions.find({}).sort([("created_at", -1)]).limit(limit):
            items.append(gym_to_billing(doc))
    else:
        uid = user["_id"]
        unit_ids: list[str] = []
        async for u in mongo.db.units.find({"resident_user_id": uid}, {"_id": 1, "code": 1}):
            unit_ids.append(u["_id"])
            unit_codes[u["_id"]] = u.get("code", u["_id"][:8])
        if unit_ids:
            async for doc in mongo.db.invoices.find({"unit_id": {"$in": unit_ids}}).sort([("created_at", -1)]):
                items.append(invoice_to_billing(doc, unit_codes.get(doc.get("unit_id"))))
        async for doc in mongo.db.reservations.find({"user_id": uid}).sort([("created_at", -1)]):
            items.append(reservation_to_billing(doc))
        async for doc in mongo.db.gym_subscriptions.find({"user_id": uid}).sort([("created_at", -1)]):
            items.append(gym_to_billing(doc))

    items.sort(key=lambda x: x.created_at, reverse=True)
    return items[:limit]


async def get_billing_doc(kind: BillingKind, doc_id: str) -> dict:
    if mongo.db is None:
        raise not_found("DB not ready")
    coll = COLLECTION_BY_KIND[kind]
    doc = await mongo.db[coll].find_one({"_id": doc_id})
    if not doc:
        raise not_found("Document not found")
    return doc


async def assert_billing_access(kind: BillingKind, doc_id: str, user: dict) -> dict:
    doc = await get_billing_doc(kind, doc_id)
    if user.get("role") == UserRole.admin.value:
        return doc
    if kind == "invoice":
        unit = await mongo.db.units.find_one({"_id": doc["unit_id"]})
        if not unit or unit.get("resident_user_id") != user["_id"]:
            raise not_found("Document not found")
    elif kind == "reservation":
        if doc.get("user_id") != user["_id"]:
            raise not_found("Document not found")
    elif kind == "gym_subscription":
        if doc.get("user_id") != user["_id"]:
            raise not_found("Document not found")
    return doc
