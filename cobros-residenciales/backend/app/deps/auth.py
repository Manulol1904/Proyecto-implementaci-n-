from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer

from app.core.errors import forbidden, unauthorized
from app.core.security import decode_token
from app.db.mongo import mongo
from app.domain.enums import UserRole


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    if not token:
        raise unauthorized()
    try:
        payload = decode_token(token)
    except Exception:
        raise unauthorized("Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise unauthorized("Invalid token payload")

    if mongo.db is None:
        raise unauthorized("DB not ready")

    user = await mongo.db.users.find_one({"_id": user_id})
    if not user:
        raise unauthorized("User not found")
    return user


def require_role(*roles: UserRole):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in [r.value for r in roles]:
            raise forbidden()
        return user

    return _dep

