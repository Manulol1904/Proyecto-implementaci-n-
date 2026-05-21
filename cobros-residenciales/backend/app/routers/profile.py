from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.core.config import settings
from app.core.errors import bad_request, not_found
from app.core.security import hash_password, verify_password
from app.db.mongo import mongo
from app.deps.auth import get_current_user
from app.domain.enums import UserRole
from app.billing.service import billing_documents_for_user
from app.domain.models import InvoicePublic, UnitPublic, UserPublic
from app.domain.profile import ChangePasswordIn, ProfileResponse, ProfileUpdate
from app.routers.invoices import _refresh_overdues


router = APIRouter()


def _factus_configured() -> bool:
    return bool(
        settings.factus_client_id
        and settings.factus_client_secret
        and settings.factus_username
        and settings.factus_password
        and settings.factus_numbering_range_id
    )


async def _invoices_for_user(user: dict) -> list[InvoicePublic]:
    if mongo.db is None:
        return []
    await _refresh_overdues()
    items: list[InvoicePublic] = []
    if user.get("role") == UserRole.admin.value:
        async for doc in mongo.db.invoices.find({}).sort([("period", -1), ("created_at", -1)]).limit(30):
            items.append(InvoicePublic(**doc))
    else:
        unit_ids: list[str] = []
        async for u in mongo.db.units.find({"resident_user_id": user["_id"]}, {"_id": 1}):
            unit_ids.append(u["_id"])
        if unit_ids:
            async for doc in mongo.db.invoices.find({"unit_id": {"$in": unit_ids}}).sort(
                [("period", -1), ("created_at", -1)]
            ):
                items.append(InvoicePublic(**doc))
    return items


@router.get("", response_model=ProfileResponse)
async def get_profile(user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    units: list[UnitPublic] = []
    if user.get("role") == UserRole.resident.value:
        async for doc in mongo.db.units.find({"resident_user_id": user["_id"]}).sort("code", 1):
            units.append(UnitPublic(**doc))

    invoices = await _invoices_for_user(user)
    billing_documents = await billing_documents_for_user(user)
    doc = await mongo.db.users.find_one({"_id": user["_id"]}, {"password_hash": 0})
    if not doc:
        raise not_found("User not found")

    return ProfileResponse(
        user=UserPublic(**doc),
        units=units,
        factus_configured=_factus_configured(),
        invoices=invoices,
        billing_documents=billing_documents,
    )


@router.patch("", response_model=UserPublic)
async def update_profile(payload: ProfileUpdate, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    update: dict = {}
    if payload.full_name is not None:
        update["full_name"] = payload.full_name.strip()
    if payload.email is not None:
        email = str(payload.email).lower()
        other = await mongo.db.users.find_one({"email": email, "_id": {"$ne": user["_id"]}})
        if other:
            raise bad_request("Email already registered")
        update["email"] = email
    if payload.tax_profile is not None:
        tp = payload.tax_profile.model_dump()
        update["tax_profile"] = tp

    if not update:
        raise bad_request("No fields to update")

    await mongo.db.users.update_one({"_id": user["_id"]}, {"$set": update})
    doc = await mongo.db.users.find_one({"_id": user["_id"]}, {"password_hash": 0})
    return UserPublic(**doc)


@router.post("/change-password")
async def change_password(payload: ChangePasswordIn, user: dict = Depends(get_current_user)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    doc = await mongo.db.users.find_one({"_id": user["_id"]})
    if not doc:
        raise not_found("User not found")
    if not verify_password(payload.current_password, doc.get("password_hash", "")):
        raise bad_request("Contraseña actual incorrecta")

    await mongo.db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return {"ok": True}
