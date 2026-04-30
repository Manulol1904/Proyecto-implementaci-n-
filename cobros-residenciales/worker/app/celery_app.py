from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.config import settings
from app.logging import configure_logging


configure_logging()

celery_app = Celery(
    "cobros_worker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks"],
)

celery_app.conf.update(
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        # Día 1 de cada mes 05:00 UTC (ajusta según operación)
        "generate_monthly_invoices_day_1": {
            "task": "app.tasks.generate_monthly_invoices",
            "schedule": crontab(minute=0, hour=5, day_of_month="1"),
        }
    },
)

