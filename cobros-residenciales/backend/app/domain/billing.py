from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

BillingKind = Literal["invoice", "reservation", "gym_subscription"]


class BillingDocumentItem(BaseModel):
    """Vista unificada de cobros con soporte Factus (administración, amenidades, gimnasio)."""

    id: str = Field(description="ID del documento origen")
    kind: BillingKind
    label: str = Field(description="Descripción legible del cobro")
    category: str = Field(description="Administración | Parqueadero | Salón | Gimnasio")
    period: str | None = None
    amount_cop: int
    status: str
    created_at: datetime
    paid_at: datetime | None = None
    unit_code: str | None = None
    amenity_code: str | None = None
    factus_invoice_id: str | None = None
    factus_number: str | None = None
    factus_cufe: str | None = None
    factus_public_url: str | None = None
    factus_error: str | None = None
    pdf_url: str | None = None
    xml_url: str | None = None
