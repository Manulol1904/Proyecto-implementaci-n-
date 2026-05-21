from typing import Any

from pydantic import BaseModel, EmailStr, Field

from app.domain.billing import BillingDocumentItem
from app.domain.models import InvoicePublic, UnitPublic, UserPublic


class TaxProfileIn(BaseModel):
    identification_document_id: int = Field(default=3, description="Legacy id; 3=CC")
    identification: str = Field(min_length=5, max_length=20)
    names: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=5, max_length=200)
    email: EmailStr
    phone: str = Field(min_length=7, max_length=20)
    municipality_id: int = Field(default=11001, ge=1)
    legal_organization_code: str = Field(default="2", description="2=persona natural")
    tribute_code: str = Field(default="ZZ")


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    tax_profile: TaxProfileIn | None = None


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ProfileResponse(BaseModel):
    user: UserPublic
    units: list[UnitPublic] = Field(default_factory=list)
    factus_configured: bool = False
    invoices: list[InvoicePublic] = Field(default_factory=list)
    billing_documents: list[BillingDocumentItem] = Field(default_factory=list)
