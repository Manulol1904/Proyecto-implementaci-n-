from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    log_level: str = "INFO"

    mongodb_uri: str = "mongodb://mongo:27017"
    mongodb_db: str = "cobros_residenciales"

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"

    backend_url: str = "http://backend:8000"
    internal_api_key: str | None = None


settings = Settings()
