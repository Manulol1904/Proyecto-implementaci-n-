from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    log_level: str = "INFO"

    mongodb_uri: str = "mongodb://mongo:27017"
    mongodb_db: str = "cobros_residenciales"

    # JWT (para proteger /payments)
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"

    payments_provider: str = "mock"  # mock|wompi|epayco
    wompi_base_url: str = "https://sandbox.wompi.co/v1"
    wompi_private_key: str | None = None
    wompi_webhook_secret: str | None = None

    # ePayco (Apify + Smart Checkout)
    epayco_public_key: str | None = None
    epayco_private_key: str | None = None
    epayco_p_cust_id_cliente: str | None = None
    epayco_p_key: str | None = None
    epayco_apify_base_url: str = "https://apify.epayco.co"
    # URL pública (https) donde ePayco enviará confirmación
    epayco_confirmation_url: str | None = None


settings = Settings()

