from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from app.core.errors import bad_request, not_found
from app.db.mongo import mongo
from app.deps.auth import get_current_user, require_role
from app.domain.enums import AmenityType, ReservationStatus, UserRole
from app.domain.models import AmenityCreate, AmenityPublic, AmenityUpdate
from app.utils.ids import new_id


router = APIRouter()


@router.post("", response_model=AmenityPublic, dependencies=[Depends(require_role(UserRole.admin))])
async def create_amenity(payload: AmenityCreate):
    if mongo.db is None:
        raise bad_request("DB not ready")

    code = payload.code.strip().upper()
    existing = await mongo.db.amenities.find_one({"code": code})
    if existing:
        raise bad_request(f"Amenity with code {code} already exists")

    now = datetime.now(timezone.utc)
    doc = {
        "_id": new_id(),
        "type": payload.type.value,
        "code": code,
        "active": bool(payload.active),
        "created_at": now,
    }
    await mongo.db.amenities.insert_one(doc)
    return AmenityPublic(**doc)


@router.get("", response_model=list[AmenityPublic])
async def list_amenities(
    type: AmenityType | None = Query(default=None),
    active: bool | None = Query(default=None),
    user: dict = Depends(get_current_user),
):
    if mongo.db is None:
        raise bad_request("DB not ready")

    q: dict = {}
    if type is not None:
        q["type"] = type.value
    if active is not None:
        q["active"] = bool(active)
    # Residentes solo ven activos.
    if user.get("role") != UserRole.admin.value:
        q["active"] = True

    items: list[AmenityPublic] = []
    async for doc in mongo.db.amenities.find(q).sort([("type", 1), ("code", 1)]):
        items.append(AmenityPublic(**doc))
    return items


@router.patch("/{amenity_id}", response_model=AmenityPublic, dependencies=[Depends(require_role(UserRole.admin))])
async def update_amenity(amenity_id: str, payload: AmenityUpdate):
    if mongo.db is None:
        raise bad_request("DB not ready")

    update: dict = {}
    if payload.code is not None:
        update["code"] = payload.code.strip().upper()
    if payload.active is not None:
        update["active"] = bool(payload.active)
    if not update:
        raise bad_request("No fields to update")

    res = await mongo.db.amenities.update_one({"_id": amenity_id}, {"$set": update})
    if res.matched_count == 0:
        raise not_found("Amenity not found")
    doc = await mongo.db.amenities.find_one({"_id": amenity_id})
    return AmenityPublic(**doc)


@router.delete("/{amenity_id}", dependencies=[Depends(require_role(UserRole.admin))])
async def delete_amenity(amenity_id: str):
    if mongo.db is None:
        raise bad_request("DB not ready")

    paid = await mongo.db.reservations.find_one(
        {"amenity_id": amenity_id, "status": ReservationStatus.pagada.value}
    )
    if paid:
        raise bad_request("Cannot delete amenity with paid reservations; deactivate it instead")

    await mongo.db.reservations.delete_many({"amenity_id": amenity_id})
    res = await mongo.db.amenities.delete_one({"_id": amenity_id})
    if res.deleted_count == 0:
        raise not_found("Amenity not found")
    return {"deleted": True}


@router.get("/{amenity_id}/availability")
async def availability(
    amenity_id: str,
    from_: datetime = Query(..., alias="from"),
    to: datetime = Query(...),
    user: dict = Depends(get_current_user),
):
    """
    Devuelve reservas activas (Pendiente/Pagada) que se solapan con el rango [from, to).
    Útil para que el frontend muestre slots ocupados.
    """
    if mongo.db is None:
        raise bad_request("DB not ready")
    _ = user  # autenticado

    amenity = await mongo.db.amenities.find_one({"_id": amenity_id})
    if not amenity:
        raise not_found("Amenity not found")

    busy: list[dict] = []
    async for r in mongo.db.reservations.find(
        {
            "amenity_id": amenity_id,
            "status": {"$in": [ReservationStatus.pendiente.value, ReservationStatus.pagada.value]},
            "start_at": {"$lt": to},
            "end_at": {"$gt": from_},
        }
    ).sort("start_at", 1):
        busy.append(
            {
                "reservation_id": r["_id"],
                "start_at": r["start_at"],
                "end_at": r["end_at"],
                "status": r["status"],
            }
        )

    return {"amenity_id": amenity_id, "from": from_, "to": to, "busy": busy}
