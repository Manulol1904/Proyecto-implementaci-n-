from enum import Enum


class UserRole(str, Enum):
    admin = "admin"
    resident = "resident"


class InvoiceStatus(str, Enum):
    pendiente = "Pendiente"
    pagada = "Pagada"
    vencida = "Vencida"


class PaymentStatus(str, Enum):
    created = "created"
    confirmed = "confirmed"
    failed = "failed"

