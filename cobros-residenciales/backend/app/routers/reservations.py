from __future__ import annotations

import math
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import settings
from app.core.errors import bad_request, forbidden, not_found
from app.db.mongo import mongo
from app.deps.auth import get_current_user
from app.domain.enums import AmenityType, ReservationStatus, UserRole
from app.domain.models import ReservationCreate, ReservationPublic
from app.utils.ids import new_id


router = APIRouter()


def _ensure_aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _compute_amount(amenity_type: str, start_at: datetime, end_at: datetime) -> int:
    delta = end_at - start_at
    seconds = delta.total_seconds()
    if seconds <= 0:
        raise bad_request("end_at must be after start_at")

    if amenity_type == AmenityType.visitor_parking.value:
        hours = max(1, math.ceil(seconds / 3600))
        return int(hours * settings.visitor_parking_hourly_cop)
    if amenity_type == AmenityType.social_hall.value:
        days = max(1, math.ceil(seconds / 86400))
        return int(days * settings.social_hall_daily_cop)
    raise bad_request(f"Unsupported amenity type: {amenity_type}")


def _visitor_pin() -> str:
    """PIN corto para portería. Se genera solo en parqueadero de visitantes."""
    return f"{secrets.randbelow(900000) + 100000:06d}"


async def _has_overlap(amenity_id: str, start_at: datetime, end_at: datetime) -> bool:
    if mongo.db is None:
        return False
    other = await mongo.db.reservations.find_one(
        {
            "amenity_id": amenity_id,
            "status": {"$in": [ReservationStatus.pendiente.value, ReservationStatus.pagada.value]},
            "start_at": {"$lt": end_at},
            "end_at": {"$gt": start_at},
        }
    )
    return other is not None


@router.post("", response_model=ReservationPublic)
async def create_reservation(payload: ReservationCreate, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    amenity = await mongo.db.amenities.find_one({"_id": payload.amenity_id})
    if not amenity:
        raise not_found("Amenity not found")
    if not amenity.get("active", True):
        raise bad_request("Amenity is not active")

    start_at = _ensure_aware_utc(payload.start_at)
    end_at = _ensure_aware_utc(payload.end_at)
    amount = _compute_amount(amenity["type"], start_at, end_at)

    if await _has_overlap(payload.amenity_id, start_at, end_at):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slot not available")

    now = datetime.now(timezone.utc)
    doc = {
        "_id": new_id(),
        "amenity_id": payload.amenity_id,
        "amenity_type": amenity["type"],
        "amenity_code": amenity["code"],
        "user_id": user["_id"],
        "access_pin": _visitor_pin() if amenity["type"] == AmenityType.visitor_parking.value else None,
        "start_at": start_at,
        "end_at": end_at,
        "amount_cop": int(amount),
        "status": ReservationStatus.pendiente.value,
        "created_at": now,
        "paid_at": None,
    }
    await mongo.db.reservations.insert_one(doc)
    return ReservationPublic(**doc)


@router.get("", response_model=list[ReservationPublic])
async def list_reservations(
    status_filter: ReservationStatus | None = Query(default=None, alias="status"),
    type_filter: AmenityType | None = Query(default=None, alias="type"),
    user: dict = Depends(get_current_user),
):
    if mongo.db is None:
        raise bad_request("DB not ready")

    q: dict = {}
    if status_filter is not None:
        q["status"] = status_filter.value
    if type_filter is not None:
        q["amenity_type"] = type_filter.value
    if user.get("role") != UserRole.admin.value:
        q["user_id"] = user["_id"]

    items: list[ReservationPublic] = []
    async for doc in mongo.db.reservations.find(q).sort([("start_at", -1), ("created_at", -1)]):
        items.append(ReservationPublic(**doc))
    return items


@router.get("/my", response_model=list[ReservationPublic])
async def my_reservations(user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")
    items: list[ReservationPublic] = []
    async for doc in mongo.db.reservations.find({"user_id": user["_id"]}).sort(
        [("start_at", -1), ("created_at", -1)]
    ):
        items.append(ReservationPublic(**doc))
    return items


@router.get("/{reservation_id}", response_model=ReservationPublic)
async def get_reservation(reservation_id: str, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")
    doc = await mongo.db.reservations.find_one({"_id": reservation_id})
    if not doc:
        raise not_found("Reservation not found")
    if user.get("role") != UserRole.admin.value and doc.get("user_id") != user["_id"]:
        raise forbidden()
    return ReservationPublic(**doc)


@router.post("/{reservation_id}/cancel", response_model=ReservationPublic)
async def cancel_reservation(reservation_id: str, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")
    doc = await mongo.db.reservations.find_one({"_id": reservation_id})
    if not doc:
        raise not_found("Reservation not found")
    if user.get("role") != UserRole.admin.value and doc.get("user_id") != user["_id"]:
        raise forbidden()
    if doc.get("status") == ReservationStatus.pagada.value and user.get("role") != UserRole.admin.value:
        raise bad_request("Already paid; only admin can cancel")

    await mongo.db.reservations.update_one(
        {"_id": reservation_id},
        {"$set": {"status": ReservationStatus.cancelada.value}},
    )
    doc["status"] = ReservationStatus.cancelada.value
    return ReservationPublic(**doc)


@router.delete("/{reservation_id}")
async def delete_reservation(reservation_id: str, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")
    if user.get("role") != UserRole.admin.value:
        raise forbidden()
    res = await mongo.db.reservations.delete_one({"_id": reservation_id})
    if res.deleted_count == 0:
        raise not_found("Reservation not found")
    return {"deleted": True}
