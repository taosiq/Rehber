from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, read from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Rehber"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://rehber:rehber@localhost:5432/rehber"
    redis_url: str = "redis://localhost:6379/0"

    # LLM + embeddings (used from Phase 2/3 on).
    # Provider is swappable: "gemini" (free tier) or "anthropic" (paid).
    llm_provider: str = "gemini"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    embedding_dim: int = 768

    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
