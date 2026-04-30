from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm

from app.core.errors import bad_request
from app.core.security import create_access_token, hash_password, verify_password
from app.db.mongo import mongo
from app.deps.auth import get_current_user
from app.domain.models import UserCreate, UserPublic
from app.utils.ids import new_id


router = APIRouter()


@router.post("/register", response_model=UserPublic)
async def register(payload: UserCreate):
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
        "role": payload.role.value,
        "password_hash": hash_password(payload.password),
        "created_at": now,
    }
    await mongo.db.users.insert_one(doc)
    return UserPublic(**doc)


@router.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    if mongo.db is None:
        raise bad_request("DB not ready")

    user = await mongo.db.users.find_one({"email": form.username.lower()})
    if not user:
        raise bad_request("Invalid credentials")
    if not verify_password(form.password, user.get("password_hash", "")):
        raise bad_request("Invalid credentials")

    token = create_access_token(subject=user["_id"], role=user["role"])
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return UserPublic(**user)

