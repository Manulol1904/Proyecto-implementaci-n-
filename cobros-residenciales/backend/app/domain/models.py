from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field

from app.domain.enums import InvoiceStatus, PaymentStatus, UserRole


class MongoModel(BaseModel):
    id: str | None = Field(default=None, alias="_id")

    model_config = {
        "populate_by_name": True,
        "from_attributes": True,
    }


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)
    role: UserRole


class UserPublic(MongoModel):
    email: EmailStr
    full_name: str
    role: UserRole
    tax_profile: dict[str, Any] | None = None
    created_at: datetime


class AdminCreateResident(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)


class AdminUpdateUser(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    tax_profile: dict[str, Any] | None = None


class AdminResetPassword(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class UnitCreate(BaseModel):
    code: str = Field(min_length=1, max_length=30, description="Ej: APT-101")
    resident_user_id: str | None = Field(default=None, description="Usuario residente asignado")
    coefficient: float = Field(gt=0, le=1, description="Coeficiente de copropiedad (0,1..1)")


class UnitUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=30)
    resident_user_id: str | None = None
    coefficient: float | None = Field(default=None, gt=0, le=1)


class UnitPublic(MongoModel):
    code: str
    resident_user_id: str | None
    coefficient: float
    created_at: datetime


class InvoicePublic(MongoModel):
    unit_id: str
    period: str = Field(description="YYYY-MM")
    base_fee_cop: int
    coefficient: float
    amount_cop: int
    due_date: datetime
    status: InvoiceStatus
    factus_invoice_id: str | None = None
    factus_number: str | None = None
    factus_cufe: str | None = None
    factus_public_url: str | None = None
    factus_error: str | None = None
    pdf_url: str | None = None
    xml_url: str | None = None
    pdf_file_id: str | None = None
    xml_file_id: str | None = None
    created_at: datetime
    paid_at: datetime | None = None


class InvoiceCreateInternal(BaseModel):
    unit_id: str
    period: str
    base_fee_cop: int
    coefficient: float
    amount_cop: int
    due_date: datetime
    status: InvoiceStatus = InvoiceStatus.pendiente
    created_at: datetime


class PaymentCreate(BaseModel):
    invoice_id: str
    provider: str = Field(description="mock|wompi|epayco")


class PaymentPublic(MongoModel):
    invoice_id: str
    provider: str
    provider_ref: str | None = None
    status: PaymentStatus
    amount_cop: int
    currency: str = "COP"
    payment_link: str | None = None
    raw_event: dict[str, Any] | None = None
    created_at: datetime
    confirmed_at: datetime | None = None

