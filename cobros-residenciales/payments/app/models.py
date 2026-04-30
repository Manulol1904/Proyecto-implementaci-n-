from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class PaymentCreate(BaseModel):
    invoice_id: str
    provider: str = Field(default="mock", description="mock|wompi|epayco")


class PaymentCreated(BaseModel):
    payment_id: str
    invoice_id: str
    provider: str
    amount_cop: int
    currency: str = "COP"
    payment_link: str


class PaymentPublic(BaseModel):
    payment_id: str = Field(alias="_id")
    invoice_id: str
    provider: str
    provider_ref: str | None = None
    status: str
    amount_cop: int
    currency: str = "COP"
    payment_link: str | None = None
    raw_event: dict[str, Any] | None = None
    created_at: datetime | None = None
    confirmed_at: datetime | None = None

    model_config = {"populate_by_name": True}


class WebhookEvent(BaseModel):
    provider_ref: str
    status: str
    raw: dict[str, Any] = Field(default_factory=dict)
    amount_cop: int | None = None


class InvoicePatch(BaseModel):
    status: str
    paid_at: datetime | None = None

