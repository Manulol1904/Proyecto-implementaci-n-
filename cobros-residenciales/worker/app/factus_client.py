from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.config import settings


@dataclass(frozen=True)
class FactusBillResult:
    reference_code: str
    number: str | None
    cufe: str | None
    qr: str | None
    public_url: str | None
    pdf_url: str | None
    xml_url: str | None
    raw: dict


class FactusClient:
    def __init__(self) -> None:
        self.host = settings.factus_host.rstrip("/")

    def enabled(self) -> bool:
        return bool(
            settings.factus_client_id
            and settings.factus_client_secret
            and settings.factus_username
            and settings.factus_password
            and settings.factus_numbering_range_id
        )

    async def get_access_token(self) -> str:
        """
        OAuth2 password grant:
        POST {host}/oauth/token (form-data)
        """
        if not self.enabled():
            raise RuntimeError("Factus not configured")

        data = {
            "grant_type": "password",
            "client_id": settings.factus_client_id or "",
            "client_secret": settings.factus_client_secret or "",
            "username": settings.factus_username or "",
            "password": settings.factus_password or "",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(f"{self.host}/oauth/token", data=data)
            r.raise_for_status()
            j = r.json()
        return str(j["access_token"])

    async def validate_bill(
        self,
        *,
        access_token: str,
        invoice: dict,
        unit: dict,
        resident_email: str | None,
        tax_profile: dict | None,
    ) -> FactusBillResult:
        """
        POST /v2/bills/validate
        Docs: developers.factus.com.co
        """
        reference_code = f"ADM-{invoice['period']}-{unit.get('code')}-{invoice['_id'][:8]}"

        customer = dict(tax_profile or {})
        # fallback: si no hay perfil fiscal, al menos intenta con correo
        if resident_email and not customer.get("email"):
            customer["email"] = resident_email

        payload = {
            "reference_code": reference_code,
            "document": settings.factus_document_type,
            "numbering_range_id": int(settings.factus_numbering_range_id or 0),
            "operation_type": settings.factus_operation_type,
            "send_email": bool(settings.factus_send_email),
            # Cliente: viene del perfil fiscal del residente (requerido para emisión real)
            "customer": customer,
            "items": [
                {
                    "code_reference": f"ADM-{unit.get('code')}",
                    "name": f"Administración {invoice['period']} - {unit.get('code')}",
                    "quantity": "1.00",
                    "discount_rate": "0.00",
                    "discount": "0.00",
                    "price": f"{float(invoice['amount_cop']):.2f}",
                    "unit_measure_id": 70,  # Unidad (depende catálogo Factus)
                    "standard_code_id": 1,
                    "taxes": [],
                }
            ],
        }

        headers = {"Accept": "application/json", "Content-Type": "application/json", "access_token": access_token}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{self.host}/v2/bills/validate", json=payload, headers=headers)
            r.raise_for_status()
            j = r.json()

        data = j.get("data") or {}
        return FactusBillResult(
            reference_code=str(data.get("reference_code") or reference_code),
            number=data.get("number"),
            cufe=data.get("cufe") or data.get("cud"),
            qr=data.get("qr") or data.get("qr_code"),
            public_url=data.get("public_url") or data.get("url") or data.get("graphic_representation_url"),
            pdf_url=data.get("pdf_url") or data.get("graphic_representation_url"),
            xml_url=data.get("xml_url"),
            raw=j,
        )

