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

    # Chat LLM. Provider is swappable; Groq has a free, no-card tier.
    llm_provider: str = "groq"
    groq_api_key: str = ""
    chat_model: str = "openai/gpt-oss-120b"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""

    # RAG answering
    retrieval_k: int = 4  # passages given to the model (kept small: free tier has a tokens/minute cap)
    min_relevance: float = 0.2  # drop passages below this cosine similarity
    history_messages: int = 8  # previous messages sent for context

    # Embeddings run locally on CPU: free, private, no rate limits.
    # EmbeddingGemma scored 8/8 on our 8-language retrieval check.
    embedding_model: str = "google/embeddinggemma-300m"
    embedding_dim: int = 768
    models_dir: Path = BACKEND_DIR / ".models"

    # Ingestion
    chunk_size: int = 1000  # characters per chunk
    chunk_overlap: int = 150
    max_upload_mb: int = 20

    # Dashboard origins allowed to call the API with cookies.
    cors_origins: list[str] = ["http://localhost:3000"]

    # --- Security ---
    # Signs widget conversation tokens. MUST be a long random value outside development.
    secret_key: str = "dev-insecure-change-me"
    session_days: int = 14
    session_cookie: str = "rehber_session"
    cookie_secure: bool = False  # True in production (HTTPS only)
    cookie_domain: str | None = None  # e.g. ".rehber.app" when API and dashboard are on subdomains

    def check_production_safety(self) -> None:
        """Refuse to start in production with development defaults."""
        if self.environment == "production":
            if self.secret_key == "dev-insecure-change-me" or len(self.secret_key) < 32:
                raise RuntimeError("Set a strong SECRET_KEY (32+ random characters) in production.")
            if not self.cookie_secure:
                raise RuntimeError("COOKIE_SECURE must be true in production.")

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
