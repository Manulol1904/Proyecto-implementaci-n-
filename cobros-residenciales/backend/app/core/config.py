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

    # CORS
    cors_allow_origins: list[str] = ["http://localhost:5173"]

    # Factus (para descargas autenticadas en backend)
    factus_host: str = "https://api-sandbox.factus.com.co"
    factus_client_id: str | None = None
    factus_client_secret: str | None = None
    factus_username: str | None = None
    factus_password: str | None = None


settings = Settings()

