from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings, read from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Rehber"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://rehber:rehber@localhost:5432/rehber"
    redis_url: str = "redis://localhost:6379/0"

    # LLM + embeddings (used from Phase 2/3 on)
    anthropic_api_key: str = ""
    llm_model: str = "claude-opus-5-5"
    voyage_api_key: str = ""
    embedding_model: str = "voyage-3.5"
    embedding_dim: int = 1024

    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
