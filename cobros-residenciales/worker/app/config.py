from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    log_level: str = "INFO"

    mongodb_uri: str = "mongodb://mongo:27017"
    mongodb_db: str = "cobros_residenciales"

    redis_url: str = "redis://redis:6379/0"

    admin_fee_base_cop: int = 300000
    invoice_due_day: int = 10
    gym_monthly_cop: int = 40000

    reservation_pending_expire_minutes: int = 30
    payment_reconcile_after_minutes: int = 30
    factus_retry_limit: int = 25

    backend_internal_url: str = "http://backend:8000"
    payments_internal_url: str = "http://payments:8002"

    # Factus (OAuth + Bills v2)
    # Sandbox: https://api-sandbox.factus.com.co
    # Prod: https://api.factus.com.co
    factus_host: str = "https://api-sandbox.factus.com.co"
    factus_client_id: str | None = None
    factus_client_secret: str | None = None
    factus_username: str | None = None
    factus_password: str | None = None
    # Requerido por bills/validate
    factus_numbering_range_id: int | None = None
    # Defaults negocio
    factus_operation_type: str = "10"  # Estándar
    factus_document_type: str = "01"  # Factura electrónica de venta
    factus_send_email: bool = False

    @field_validator("factus_numbering_range_id", mode="before")
    @classmethod
    def _empty_int_to_none(cls, value):
        if value == "":
            return None
        return value


settings = Settings()

