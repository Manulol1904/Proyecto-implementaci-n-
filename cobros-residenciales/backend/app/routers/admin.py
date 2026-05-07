from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from app.core.config import settings
from app.core.errors import bad_request
from app.core.security import hash_password
from app.db.mongo import mongo
from app.deps.auth import require_role
from app.domain.enums import UserRole
from app.domain.models import AdminCreateResident, AdminResetPassword, AdminUpdateUser, UserPublic
from app.routers.invoices import generate_invoices
from app.utils.ids import new_id


router = APIRouter()


@router.get(
    "/users",
    response_model=list[UserPublic],
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def list_users(role: UserRole | None = Query(default=None)):
    if mongo.db is None:
        raise bad_request("DB not ready")

    q: dict = {}
    if role is not None:
        q["role"] = role.value

    items: list[UserPublic] = []
    async for doc in mongo.db.users.find(q, {"password_hash": 0}).sort("created_at", -1):
        items.append(UserPublic(**doc))
    return items


@router.post(
    "/residents",
    response_model=UserPublic,
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def create_resident(payload: AdminCreateResident):
    if mongo.db is None:
        raise bad_request("DB not ready")

    existing = await mongo.db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise bad_request("Email already registered")

    now = datetime.now(timezone.utc)
    doc = {
        "_id": new_id(),
        "email": payload.email.lower(),
        "full_name": payload.full_name.strip(),
        "role": UserRole.resident.value,
        "password_hash": hash_password(payload.password),
        "created_at": now,
    }
    await mongo.db.users.insert_one(doc)
    doc.pop("password_hash", None)
    return UserPublic(**doc)


@router.patch(
    "/users/{user_id}",
    response_model=UserPublic,
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def update_user(user_id: str, payload: AdminUpdateUser):
    if mongo.db is None:
        raise bad_request("DB not ready")

    update: dict = {}
    if payload.email is not None:
        update["email"] = payload.email.lower()
    if payload.full_name is not None:
        update["full_name"] = payload.full_name.strip()
    if payload.tax_profile is not None:
        update["tax_profile"] = payload.tax_profile

    if not update:
        raise bad_request("No fields to update")

    res = await mongo.db.users.update_one({"_id": user_id}, {"$set": update})
    if res.matched_count == 0:
        raise bad_request("User not found")

    doc = await mongo.db.users.find_one({"_id": user_id}, {"password_hash": 0})
    return UserPublic(**doc)


@router.post(
    "/users/{user_id}/reset-password",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def reset_user_password(user_id: str, payload: AdminResetPassword):
    if mongo.db is None:
        raise bad_request("DB not ready")

    res = await mongo.db.users.update_one(
        {"_id": user_id},
        {"$set": {"password_hash": hash_password(payload.password)}},
    )
    if res.matched_count == 0:
        raise bad_request("User not found")
    return {"ok": True}


@router.delete(
    "/users/{user_id}",
    dependencies=[Depends(require_role(UserRole.admin))],
)
async def delete_user(user_id: str):
    """
    Elimina usuario (útil para borrar residentes).
    También desasigna unidades que apunten a ese residente.
    """
    if mongo.db is None:
        raise bad_request("DB not ready")

    await mongo.db.units.update_many({"resident_user_id": user_id}, {"$set": {"resident_user_id": None}})
    res = await mongo.db.users.delete_one({"_id": user_id})
    if res.deleted_count == 0:
        raise bad_request("User not found")
    return {"deleted": True}


@router.post(
    "/seed-demo",
)
async def seed_demo():
    """
    Crea datos de ejemplo para demo (solo recomendado en dev).
    Devuelve credenciales generadas para que puedas iniciar sesión.
    """
    if settings.app_env != "dev":
        raise bad_request("seed-demo only available in dev")
    if mongo.db is None:
        raise bad_request("DB not ready")

    # Admin demo
    admin_email = "admin_demo@conjunto.com"
    admin_pwd = "Admin12345!"

    now = datetime.now(timezone.utc)

    async def ensure_user(email: str, pwd: str, full_name: str, role: UserRole) -> str:
        u = await mongo.db.users.find_one({"email": email})
        if u:
            # Asegura que las credenciales demo siempre funcionen en dev.
            await mongo.db.users.update_one(
                {"_id": u["_id"]},
                {
                    "$set": {
                        "full_name": full_name,
                        "role": role.value,
                        "password_hash": hash_password(pwd),
                    }
                },
            )
            return u["_id"]
        doc = {
            "_id": new_id(),
            "email": email,
            "full_name": full_name,
            "role": role.value,
            "password_hash": hash_password(pwd),
            "created_at": now,
        }
        await mongo.db.users.insert_one(doc)
        return doc["_id"]

    admin_id = await ensure_user(admin_email, admin_pwd, "Admin Demo", UserRole.admin)
    demo_residents = [
        {"email": "residente_demo@conjunto.com", "password": "Residente123!", "full_name": "Residente Demo", "cc": "22222222"},
        {"email": "ana@conjunto.com", "password": "Residente123!", "full_name": "Ana Gómez", "cc": "1002003001"},
        {"email": "carlos@conjunto.com", "password": "Residente123!", "full_name": "Carlos Ramírez", "cc": "1002003002"},
        {"email": "laura@conjunto.com", "password": "Residente123!", "full_name": "Laura Martínez", "cc": "1002003003"},
        {"email": "david@conjunto.com", "password": "Residente123!", "full_name": "David Rodríguez", "cc": "1002003004"},
    ]

    resident_ids: dict[str, str] = {}
    for r in demo_residents:
        rid = await ensure_user(r["email"], r["password"], r["full_name"], UserRole.resident)
        resident_ids[r["email"]] = rid
        # Perfil fiscal mínimo (ejemplo) para Factus sandbox (ajusta a tu catálogo real)
        await mongo.db.users.update_one(
            {"_id": rid},
            {
                "$set": {
                    "tax_profile": {
                        "identification_document_id": 3,
                        "identification": r["cc"],
                        "names": r["full_name"],
                        "address": "Cra 1 # 1-01",
                        "email": r["email"],
                        "phone": "3000000000",
                        "municipality_id": 11001,
                    }
                }
            },
        )

    # Create 3 units (some assigned)
    async def ensure_unit(code: str, coeff: float, resident_user_id: str | None) -> str:
        u = await mongo.db.units.find_one({"code": code})
        if u:
            return u["_id"]
        doc = {
            "_id": new_id(),
            "code": code,
            "resident_user_id": resident_user_id,
            "coefficient": float(coeff),
            "created_at": now,
        }
        await mongo.db.units.insert_one(doc)
        return doc["_id"]

    # Unidades asignadas a residentes (para que el panel del residente muestre facturas)
    await ensure_unit("APT-101", 0.01, resident_ids["residente_demo@conjunto.com"])
    await ensure_unit("APT-102", 0.0125, resident_ids["ana@conjunto.com"])
    await ensure_unit("APT-103", 0.011, resident_ids["carlos@conjunto.com"])
    await ensure_unit("APT-201", 0.02, resident_ids["laura@conjunto.com"])
    await ensure_unit("APT-202", 0.018, resident_ids["david@conjunto.com"])
    # Unidades sin asignar (para que admin las asigne desde UI)
    await ensure_unit("APT-301", 0.015, None)
    await ensure_unit("APT-302", 0.0175, None)

    # Generate invoices for current month
    await generate_invoices(period=None)

    return {
        "created": True,
        "admin": {"email": admin_email, "password": admin_pwd, "user_id": admin_id},
        "residents": [
            {"email": r["email"], "password": r["password"], "user_id": resident_ids[r["email"]], "full_name": r["full_name"]}
            for r in demo_residents
        ],
        "notes": "Si ya existían, se reutilizan y se actualizan contraseñas/roles. Crea varias unidades asignadas y algunas sin asignar.",
    }

