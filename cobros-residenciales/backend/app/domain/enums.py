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


class AmenityType(str, Enum):
    visitor_parking = "visitor_parking"
    social_hall = "social_hall"


class ReservationStatus(str, Enum):
    pendiente = "Pendiente"
    pagada = "Pagada"
    cancelada = "Cancelada"


class GymSubscriptionStatus(str, Enum):
    pendiente = "Pendiente"
    pagada = "Pagada"


class PaymentTargetKind(str, Enum):
    invoice = "invoice"
    reservation = "reservation"
    gym_subscription = "gym_subscription"

