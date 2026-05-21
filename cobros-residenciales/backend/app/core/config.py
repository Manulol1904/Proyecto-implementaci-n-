from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    log_level: str = "INFO"

    mongodb_uri: str = "mongodb://mongo:27017"
    mongodb_db: str = "cobros_residenciales"

    # Redis (Celery broker/client)
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720

    admin_fee_base_cop: int = 300000
    invoice_due_day: int = 10

    visitor_parking_hourly_cop: int = 2000
    social_hall_daily_cop: int = 150000
    gym_monthly_cop: int = 40000

    # Orígenes extra en prod: CORS_EXTRA_ORIGINS=https://app.ejemplo.com,https://otro.com
    cors_extra_origins: str = ""

    # Factus (para descargas autenticadas en backend)
    factus_host: str = "https://api-sandbox.factus.com.co"
    factus_client_id: str | None = None
    factus_client_secret: str | None = None
    factus_username: str | None = None
    factus_password: str | None = None
    factus_numbering_range_id: int | None = None

    # Llamadas internas (payments → backend para encolar Factus)
    internal_api_key: str | None = None
    backend_public_url: str = "http://localhost:8000"


settings = Settings()

