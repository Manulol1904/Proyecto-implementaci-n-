from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.core.config import settings
from app.core.errors import bad_request, forbidden, not_found
from app.db.mongo import mongo
from app.deps.auth import get_current_user, require_role
from app.domain.enums import GymSubscriptionStatus, UserRole
from app.domain.models import GymSubscriptionCreate, GymSubscriptionPublic


router = APIRouter()


def _current_period() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


def _valid_period(period: str) -> bool:
    try:
        y, m = period.split("-")
        yi = int(y)
        mi = int(m)
        return 1900 <= yi <= 2100 and 1 <= mi <= 12
    except Exception:
        return False


@router.post("/subscriptions", response_model=GymSubscriptionPublic)
async def create_subscription(
    payload: GymSubscriptionCreate,
    user: dict = Depends(get_current_user),
):
    """
    Crea (o reutiliza) la suscripción del periodo para el usuario actual.
    Idempotente: `_id = gym_{period}_{user_id}`.
    Admin puede crear para sí mismo; para crear para otro usuario debe usar /admin (no expuesto aquí).
    """
    if mongo.db is None:
        raise bad_request("DB not ready")

    period = (payload.period or _current_period()).strip()
    if not _valid_period(period):
        raise bad_request("Invalid period. Use YYYY-MM")

    sub_id = f"gym_{period}_{user['_id']}"
    existing = await mongo.db.gym_subscriptions.find_one({"_id": sub_id})
    if existing:
        return GymSubscriptionPublic(**existing)

    now = datetime.now(timezone.utc)
    doc = {
        "_id": sub_id,
        "user_id": user["_id"],
        "period": period,
        "amount_cop": int(settings.gym_monthly_cop),
        "status": GymSubscriptionStatus.pendiente.value,
        "created_at": now,
        "paid_at": None,
    }
    await mongo.db.gym_subscriptions.insert_one(doc)
    return GymSubscriptionPublic(**doc)


@router.get("/subscriptions/my", response_model=list[GymSubscriptionPublic])
async def my_subscriptions(user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")
    items: list[GymSubscriptionPublic] = []
    async for doc in mongo.db.gym_subscriptions.find({"user_id": user["_id"]}).sort("period", -1):
        items.append(GymSubscriptionPublic(**doc))
    return items


@router.get(
    "/subscriptions",
    response_model=list[GymSubscriptionPublic],
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def list_subscriptions(period: str | None = None, status: GymSubscriptionStatus | None = None):
    if mongo.db is None:
        raise bad_request("DB not ready")
    q: dict = {}
    if period:
        if not _valid_period(period):
            raise bad_request("Invalid period. Use YYYY-MM")
        q["period"] = period
    if status is not None:
        q["status"] = status.value
    items: list[GymSubscriptionPublic] = []
    async for doc in mongo.db.gym_subscriptions.find(q).sort([("period", -1), ("created_at", -1)]):
        items.append(GymSubscriptionPublic(**doc))
    return items


@router.get("/subscriptions/{sub_id}", response_model=GymSubscriptionPublic)
async def get_subscription(sub_id: str, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")
    doc = await mongo.db.gym_subscriptions.find_one({"_id": sub_id})
    if not doc:
        raise not_found("Subscription not found")
    if user.get("role") != UserRole.admin.value and doc.get("user_id") != user["_id"]:
        raise forbidden()
    return GymSubscriptionPublic(**doc)


@router.delete("/subscriptions/{sub_id}", dependencies=[Depends(require_role(UserRole.admin))])
async def delete_subscription(sub_id: str):
    if mongo.db is None:
        raise bad_request("DB not ready")
    res = await mongo.db.gym_subscriptions.delete_one({"_id": sub_id})
    if res.deleted_count == 0:
        raise not_found("Subscription not found")
    return {"deleted": True}
