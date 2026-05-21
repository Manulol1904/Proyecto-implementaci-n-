from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field

from app.domain.enums import (
    AmenityType,
    GymSubscriptionStatus,
    InvoiceStatus,
    PaymentStatus,
    ReservationStatus,
    UserRole,
)


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
    provider: str = Field(default="mock", description="API interna de pagos")


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


class AmenityCreate(BaseModel):
    type: AmenityType
    code: str = Field(min_length=1, max_length=30, description="Ej: VIS-01, SALON-A")
    active: bool = True


class AmenityUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=30)
    active: bool | None = None


class AmenityPublic(MongoModel):
    type: AmenityType
    code: str
    active: bool
    created_at: datetime


class ReservationCreate(BaseModel):
    amenity_id: str
    start_at: datetime
    end_at: datetime


class CalendarAmenityItem(BaseModel):
    id: str = Field(alias="_id")
    type: AmenityType
    code: str
    active: bool

    model_config = {"populate_by_name": True}


class CalendarEventItem(BaseModel):
    reservation_id: str
    amenity_id: str
    amenity_code: str
    amenity_type: AmenityType
    start_at: datetime
    end_at: datetime
    status: ReservationStatus
    user_id: str
    user_name: str | None = None
    is_mine: bool = False


class ReservationCalendarResponse(BaseModel):
    from_at: datetime = Field(alias="from")
    to_at: datetime = Field(alias="to")
    amenities: list[CalendarAmenityItem]
    events: list[CalendarEventItem]

    model_config = {"populate_by_name": True}


class ReservationPublic(MongoModel):
    amenity_id: str
    amenity_type: AmenityType
    amenity_code: str
    user_id: str
    access_pin: str | None = None
    start_at: datetime
    end_at: datetime
    amount_cop: int
    status: ReservationStatus
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


class GymSubscriptionCreate(BaseModel):
    period: str | None = Field(default=None, description="YYYY-MM (opcional)")


class GymSubscriptionPublic(MongoModel):
    user_id: str
    period: str
    amount_cop: int
    status: GymSubscriptionStatus
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

