from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone


@dataclass(frozen=True)
class Period:
    year: int
    month: int

    @property
    def key(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"

    @staticmethod
    def from_date(d: date) -> "Period":
        return Period(d.year, d.month)


def due_date_for_period(period: Period, due_day: int) -> datetime:
    due_day = max(1, min(28, int(due_day)))
    return datetime(period.year, period.month, due_day, 23, 59, 59, tzinfo=timezone.utc)


def amount_for_unit(base_fee_cop: int, coefficient: float) -> int:
    return int(round(float(base_fee_cop) * float(coefficient)))

