from __future__ import annotations

from fastapi import APIRouter, Depends, Query
import httpx

from app.core.config import settings
from app.core.errors import bad_request
from app.deps.auth import require_role
from app.domain.enums import UserRole


router = APIRouter()


def _factus_enabled() -> bool:
    return bool(settings.factus_client_id and settings.factus_client_secret and settings.factus_username and settings.factus_password)


async def _factus_access_token() -> str:
    if not _factus_enabled():
        raise bad_request("Factus not configured")
    data = {
        "grant_type": "password",
        "client_id": settings.factus_client_id or "",
        "client_secret": settings.factus_client_secret or "",
        "username": settings.factus_username or "",
        "password": settings.factus_password or "",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{settings.factus_host.rstrip('/')}/oauth/token", data=data)
        r.raise_for_status()
        j = r.json()
    return str(j["access_token"])


@router.get("/municipalities", dependencies=[Depends(require_role(UserRole.admin))])
async def municipalities(name: str | None = Query(default=None)):
    """
    Proxy de catálogos Factus: Municipios.
    Docs: https://developers.factus.com.co/tablas-de-referencia/municipios/
    """
    token = await _factus_access_token()
    headers = {"Accept": "application/json", "access_token": token}
    params = {"name": name} if name else None
    async with httpx.AsyncClient(timeout=30) as client:
        # Docs muestran v1/v2 dependiendo del módulo; v2 usa /v2/municipalities
        r = await client.get(f"{settings.factus_host.rstrip('/')}/v2/municipalities", headers=headers, params=params)
        r.raise_for_status()
        return r.json()


@router.get("/measurement-units", dependencies=[Depends(require_role(UserRole.admin))])
async def measurement_units(name: str | None = Query(default=None)):
    """
    Proxy de catálogos Factus: Unidades de medida.
    Docs: https://developers.factus.com.co/tablas-de-referencia/unit-measures/
    """
    token = await _factus_access_token()
    headers = {"Accept": "application/json", "access_token": token}
    params = {"name": name} if name else None
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{settings.factus_host.rstrip('/')}/v2/measurement-units", headers=headers, params=params)
        r.raise_for_status()
        return r.json()

