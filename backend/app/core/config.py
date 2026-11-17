from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """App settings, read from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "Rehber"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://rehber:rehber@localhost:5432/rehber"
    redis_url: str = "redis://localhost:6379/0"

    # Chat LLM (Phase 3). Provider is swappable.
    llm_provider: str = "gemini"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""

    # Embeddings run locally on CPU: free, private, no rate limits.
    # EmbeddingGemma scored 8/8 on our 8-language retrieval check.
    embedding_model: str = "google/embeddinggemma-300m"
    embedding_dim: int = 768
    models_dir: Path = BACKEND_DIR / ".models"

    # Ingestion
    chunk_size: int = 1000  # characters per chunk
    chunk_overlap: int = 150
    max_upload_mb: int = 20

    cors_origins: list[str] = ["http://localhost:3000"]

    @property
    def async_database_url(self) -> str:
        """Accept plain postgres:// URLs (e.g. from cloud providers) and use asyncpg."""
        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                url = "postgresql+asyncpg://" + url[len(prefix):]
        return url.replace("sslmode=require", "ssl=require")


@lru_cache
def get_settings() -> Settings:
    return Settings()
