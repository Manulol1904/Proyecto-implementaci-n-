from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.core.errors import bad_request, not_found
from app.db.mongo import mongo
from app.deps.auth import require_role
from app.domain.enums import UserRole
from app.domain.models import UnitCreate, UnitPublic, UnitUpdate
from app.utils.ids import new_id


router = APIRouter()


@router.post("", response_model=UnitPublic, dependencies=[Depends(require_role(UserRole.admin))])
async def create_unit(payload: UnitCreate):
    if mongo.db is None:
        raise bad_request("DB not ready")

    now = datetime.now(timezone.utc)
    doc = {
        "_id": new_id(),
        "code": payload.code.strip().upper(),
        "resident_user_id": payload.resident_user_id,
        "coefficient": float(payload.coefficient),
        "created_at": now,
    }
    try:
        await mongo.db.units.insert_one(doc)
    except Exception as e:
        raise bad_request(f"Cannot create unit: {e}")
    return UnitPublic(**doc)


@router.get("", response_model=list[UnitPublic], dependencies=[Depends(require_role(UserRole.admin))])
async def list_units():
    if mongo.db is None:
        raise bad_request("DB not ready")

    items: list[UnitPublic] = []
    async for doc in mongo.db.units.find({}).sort("code", 1):
        items.append(UnitPublic(**doc))
    return items


@router.get("/{unit_id}", response_model=UnitPublic, dependencies=[Depends(require_role(UserRole.admin))])
async def get_unit(unit_id: str):
    if mongo.db is None:
        raise bad_request("DB not ready")
    doc = await mongo.db.units.find_one({"_id": unit_id})
    if not doc:
        raise not_found("Unit not found")
    return UnitPublic(**doc)


@router.patch("/{unit_id}", response_model=UnitPublic, dependencies=[Depends(require_role(UserRole.admin))])
async def update_unit(unit_id: str, payload: UnitUpdate):
    if mongo.db is None:
        raise bad_request("DB not ready")

    update: dict = {}
    if payload.code is not None:
        update["code"] = payload.code.strip().upper()
    if payload.resident_user_id is not None:
        update["resident_user_id"] = payload.resident_user_id
    if payload.coefficient is not None:
        update["coefficient"] = float(payload.coefficient)

    if not update:
        raise bad_request("No fields to update")

    res = await mongo.db.units.update_one({"_id": unit_id}, {"$set": update})
    if res.matched_count == 0:
        raise not_found("Unit not found")
    doc = await mongo.db.units.find_one({"_id": unit_id})
    return UnitPublic(**doc)


@router.delete("/{unit_id}", dependencies=[Depends(require_role(UserRole.admin))])
async def delete_unit(unit_id: str):
    if mongo.db is None:
        raise bad_request("DB not ready")
    res = await mongo.db.units.delete_one({"_id": unit_id})
    if res.deleted_count == 0:
        raise not_found("Unit not found")
    await mongo.db.invoices.delete_many({"unit_id": unit_id})
    return {"deleted": True}

