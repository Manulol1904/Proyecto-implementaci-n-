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


def factus_auth_headers(access_token: str, *, json_body: bool = False) -> dict[str, str]:
    """Factus API v2 usa Authorization Bearer (no el header access_token legacy)."""
    headers = {"Accept": "application/json", "Authorization": f"Bearer {access_token}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def build_factus_customer_v2(tax_profile: dict | None, resident_email: str | None) -> dict:
    """
    Mapea tax_profile guardado en Mongo (campos legacy) al esquema customer de Factus v2.
    """
    tp = dict(tax_profile or {})

    doc_code = tp.get("identification_document_code")
    if not doc_code and tp.get("identification_document_id") is not None:
        legacy_map = {3: "13", 5: "22", 6: "31"}
        doc_code = legacy_map.get(int(tp["identification_document_id"]), "13")

    muni = tp.get("municipality_code") or tp.get("municipality_id")
    municipality_code = str(muni) if muni not in (None, "", 0) else "11001"

    customer: dict = {
        "identification_document_code": str(doc_code or "13"),
        "identification": str(tp.get("identification", "")),
        "legal_organization_code": str(tp.get("legal_organization_code", "2")),
        "tribute_code": str(tp.get("tribute_code", "ZZ")),
        "names": str(tp.get("names", "")),
        "municipality_code": municipality_code,
    }
    for field in ("address", "email", "phone"):
        if tp.get(field):
            customer[field] = str(tp[field])
    if not customer.get("email") and resident_email:
        customer["email"] = resident_email
    return customer


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
        """OAuth2 password grant: POST {host}/oauth/token (form-data)."""
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

    async def validate_service_bill(
        self,
        *,
        access_token: str,
        reference_code: str,
        item_code: str,
        item_name: str,
        amount_cop: int,
        resident_email: str | None,
        tax_profile: dict | None,
    ) -> FactusBillResult:
        """POST /v2/bills/validate — Factus API v2 (cualquier servicio del conjunto)."""
        amount = f"{float(amount_cop):.2f}"
        customer = build_factus_customer_v2(tax_profile, resident_email)

        payload = {
            "reference_code": reference_code,
            "document": settings.factus_document_type,
            "numbering_range_id": int(settings.factus_numbering_range_id or 0),
            "operation_type": settings.factus_operation_type,
            "send_email": bool(settings.factus_send_email),
            "payment_details": [
                {
                    "payment_form": "1",
                    "payment_method_code": "42",
                    "reference_code": reference_code,
                    "amount": amount,
                }
            ],
            "customer": customer,
            "items": [
                {
                    "code_reference": item_code[:30],
                    "name": item_name[:250],
                    "quantity": "1.00",
                    "discount_rate": "0.00",
                    "price": amount,
                    "unit_measure_code": "94",
                    "standard_code": "999",
                    "taxes": [{"code": "01", "rate": "0.00", "is_excluded": True}],
                }
            ],
        }

        headers = factus_auth_headers(access_token, json_body=True)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{self.host}/v2/bills/validate", json=payload, headers=headers)
            r.raise_for_status()
            j = r.json()

        data = j.get("data") or j
        bill = data.get("bill") or data
        return FactusBillResult(
            reference_code=str(bill.get("reference_code") or data.get("reference_code") or reference_code),
            number=bill.get("number") or data.get("number"),
            cufe=bill.get("cufe") or bill.get("cud") or data.get("cufe") or data.get("cud"),
            qr=bill.get("qr") or bill.get("qr_code") or data.get("qr"),
            public_url=bill.get("public_url") or bill.get("url") or data.get("public_url"),
            pdf_url=bill.get("pdf_url") or bill.get("graphic_representation_url") or data.get("pdf_url"),
            xml_url=bill.get("xml_url") or data.get("xml_url"),
            raw=j,
        )

    async def validate_bill(
        self,
        *,
        access_token: str,
        invoice: dict,
        unit: dict,
        resident_email: str | None,
        tax_profile: dict | None,
    ) -> FactusBillResult:
        """Cuota de administración (unidad residencial)."""
        reference_code = f"ADM-{invoice['period']}-{unit.get('code')}-{invoice['_id'][:8]}"
        return await self.validate_service_bill(
            access_token=access_token,
            reference_code=reference_code,
            item_code=f"ADM-{unit.get('code')}",
            item_name=f"Administración {invoice['period']} - {unit.get('code')}",
            amount_cop=int(invoice["amount_cop"]),
            resident_email=resident_email,
            tax_profile=tax_profile,
        )
