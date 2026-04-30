from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.core.errors import bad_request
from app.db.mongo import mongo
from app.deps.auth import require_role
from app.domain.enums import InvoiceStatus, UserRole


router = APIRouter()


@router.get("/dashboard", dependencies=[Depends(require_role(UserRole.admin))])
async def dashboard():
    if mongo.db is None:
        raise bad_request("DB not ready")

    now = datetime.now(timezone.utc)
    await mongo.db.invoices.update_many(
        {"status": InvoiceStatus.pendiente.value, "due_date": {"$lt": now}},
        {"$set": {"status": InvoiceStatus.vencida.value}},
    )

    total_recaudado = await mongo.db.invoices.aggregate(
        [{"$match": {"status": InvoiceStatus.pagada.value}}, {"$group": {"_id": None, "s": {"$sum": "$amount_cop"}}}]
    ).to_list(length=1)
    total_recaudado = (total_recaudado[0]["s"] if total_recaudado else 0) or 0

    pendientes = await mongo.db.invoices.count_documents({"status": InvoiceStatus.pendiente.value})
    vencidas = await mongo.db.invoices.count_documents({"status": InvoiceStatus.vencida.value})
    pagadas = await mongo.db.invoices.count_documents({"status": InvoiceStatus.pagada.value})

    return {
        "total_recaudado_cop": int(total_recaudado),
        "facturas": {"pendientes": pendientes, "vencidas": vencidas, "pagadas": pagadas},
    }


@router.get("/morosidad", dependencies=[Depends(require_role(UserRole.admin))])
async def morosidad():
    """
    Reporte simple de morosidad:
    - unidades con facturas vencidas
    - total adeudado y cantidad
    """
    if mongo.db is None:
        raise bad_request("DB not ready")

    pipeline = [
        {"$match": {"status": InvoiceStatus.vencida.value}},
        {
            "$group": {
                "_id": "$unit_id",
                "count": {"$sum": 1},
                "amount": {"$sum": "$amount_cop"},
                "last_due": {"$max": "$due_date"},
            }
        },
        {"$sort": {"amount": -1}},
        {"$limit": 100},
    ]
    rows = await mongo.db.invoices.aggregate(pipeline).to_list(length=100)

    out: list[dict] = []
    for r in rows:
        unit = await mongo.db.units.find_one({"_id": r["_id"]})
        resident = None
        if unit and unit.get("resident_user_id"):
            resident = await mongo.db.users.find_one({"_id": unit.get("resident_user_id")}, {"password_hash": 0})
        out.append(
            {
                "unit_id": r["_id"],
                "unit_code": (unit or {}).get("code"),
                "resident_email": (resident or {}).get("email"),
                "overdue_count": int(r.get("count") or 0),
                "overdue_amount_cop": int(r.get("amount") or 0),
                "last_due_date": r.get("last_due"),
            }
        )
    return out

