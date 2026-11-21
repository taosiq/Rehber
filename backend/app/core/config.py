from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """App settings, read from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "Rehber"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://rehber:rehber@127.0.0.1:5432/rehber"
    redis_url: str = "redis://127.0.0.1:6379/0"

    # Chat LLM. Provider is swappable; Groq has a free, no-card tier.
    llm_provider: str = "groq"
    groq_api_key: str = ""
    chat_model: str = "openai/gpt-oss-120b"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""

    # List prices in USD per 1M tokens (input, output), used for cost estimates. The free tier costs
    # nothing, but the dashboard shows what the same traffic would cost on a paid plan.
    model_prices: dict[str, tuple[float, float]] = {
        "openai/gpt-oss-120b": (0.15, 0.60),
        "openai/gpt-oss-20b": (0.075, 0.30),
        "llama-3.3-70b-versatile": (0.59, 0.79),
        "llama-3.1-8b-instant": (0.05, 0.08),
    }

    # Langfuse tracing (optional). On when both keys are set.
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "https://cloud.langfuse.com"  # EU region; US: https://us.cloud.langfuse.com
    langfuse_mask_pii: bool = True  # replace emails and phone numbers before they leave the server

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
    # Behind our own proxies (Tailscale Funnel -> Next.js -> API) read the visitor IP from
    # X-Forwarded-For, but only when the request comes from a local proxy. See app/core/net.py.
    trust_proxy: bool = False

    # The address people use to open Rehber, used in email links, e.g. https://rehber-pc.tail1234.ts.net
    public_url: str = "http://localhost:3000"

    # --- Email ---
    # "console" prints emails to the log (development). "brevo" sends through Brevo's HTTPS API
    # (free: 300/day); HTTPS works where SMTP ports are blocked.
    email_provider: str = "console"
    brevo_api_key: str = ""
    email_from: str = ""  # a sender address verified in Brevo, e.g. you@gmail.com
    email_from_name: str = "Rehber"

    # --- WhatsApp (Meta WhatsApp Cloud API, free test number) ---
    # One Meta app for the whole platform: its App Secret checks that webhook calls really come from
    # Meta, and the verify token is typed into Meta once when the webhook is set up. Each business then
    # connects its own number (phone number ID + access token) from the dashboard.
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_graph_url: str = "https://graph.facebook.com"
    whatsapp_graph_version: str = "v25.0"

    def check_production_safety(self) -> None:
        """Refuse to start in production with development defaults."""
        if self.environment == "production":
            if self.secret_key == "dev-insecure-change-me" or len(self.secret_key) < 32:
                raise RuntimeError("Set a strong SECRET_KEY (32+ random characters) in production.")
            if not self.cookie_secure:
                raise RuntimeError("COOKIE_SECURE must be true in production.")
            if not self.public_url.startswith("https://"):
                raise RuntimeError("PUBLIC_URL must be the https:// address of the site in production.")
            if self.email_provider == "brevo" and not (self.brevo_api_key and self.email_from):
                raise RuntimeError("EMAIL_PROVIDER=brevo needs BREVO_API_KEY and EMAIL_FROM.")

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
