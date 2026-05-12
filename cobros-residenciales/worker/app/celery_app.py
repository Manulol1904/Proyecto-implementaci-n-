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
        # Día 1 de cada mes 05:00 UTC = medianoche Colombia (UTC-5)
        "generate_monthly_invoices_day_1": {
            "task": "app.tasks.generate_monthly_invoices",
            "schedule": crontab(minute=0, hour=5, day_of_month="1"),
        },
        "create_monthly_gym_subscriptions_day_1": {
            "task": "app.tasks.create_monthly_gym_subscriptions",
            "schedule": crontab(minute=10, hour=5, day_of_month="1"),
        },
        # Diario: mantener estados de cartera consistentes.
        "mark_overdue_invoices_daily": {
            "task": "app.tasks.mark_overdue_invoices",
            "schedule": crontab(minute=0, hour=6),
        },
        # Cada 15 minutos: liberar recursos reservados pero no pagados.
        "cancel_stale_pending_reservations": {
            "task": "app.tasks.cancel_stale_pending_reservations",
            "schedule": crontab(minute="*/15"),
        },
        # Cada 6 horas: reintentos transitorios de Factus.
        "retry_factus_errors_every_6h": {
            "task": "app.tasks.retry_factus_errors",
            "schedule": crontab(minute=20, hour="*/6"),
        },
        # Cada hora: conciliación demo/mock y métricas para dashboard/reportes.
        "reconcile_mock_payments_hourly": {
            "task": "app.tasks.reconcile_mock_payments",
            "schedule": crontab(minute=35),
        },
        "precompute_metrics_hourly": {
            "task": "app.tasks.precompute_metrics",
            "schedule": crontab(minute=45),
        },
        # Health-check liviano para observabilidad.
        "health_check_every_5m": {
            "task": "app.tasks.health_check",
            "schedule": crontab(minute="*/5"),
        },
    },
)

