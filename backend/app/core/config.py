"""
Application Configuration.

Manages todas as configuracoes da aplicacao via variaveis de ambiente
usando Pydantic Settings.
"""

from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Configuracoes da aplicacao carregadas de variaveis de ambiente.

    Todas as variaveis podem ser sobrescritas via .env or environment.
    """

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # =================== APP ===================
    PROJECT_NAME: str = "Review Hub API"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # =================== CORS ===================
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:8080,http://127.0.0.1:8080,https://review-ai-hub.vercel.app"

    @property
    def cors_origins_list(self) -> list[str]:
        """Return lista de origens CORS with fallback seguro for desenvolvimento."""
        configured = [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]
        # Mantem origens essenciais for desenvolvimento mesmo quando CORS_ORIGINS in the .env estiver desatualizado.
        defaults = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "https://review-ai-hub.vercel.app",
        ]
        merged: list[str] = []
        for origin in [*configured, *defaults]:
            if origin not in merged:
                merged.append(origin)
        return merged

    # =================== SUPABASE ===================
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_ANON_KEY: str
    SUPABASE_JWT_SECRET: str | None = None
    # local | production (default: production)
    SUPABASE_ENV: str | None = None

    # =================== DATABASE ===================
    # Connection string do Postgres (Supabase or local)
    DATABASE_URL: PostgresDsn
    # Direct connection (bypasses PgBouncer) — required for Alembic migrations.
    # Set this to the Supabase "Direct connection" URL (port 5432, db.xxx.supabase.co).
    # Falls back to DATABASE_URL in local dev where there is in the pooler.
    DIRECT_DATABASE_URL: str | None = None

    @property
    def async_database_url(self) -> str:
        """Return a URL do banco for uso with asyncpg."""
        url = str(self.DATABASE_URL)
        async_url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        parsed = urlparse(async_url)
        query_items = dict(parse_qsl(parsed.query, keep_blank_values=True))
        if "sslmode" in query_items and "ssl" not in query_items:
            query_items["ssl"] = query_items.pop("sslmode")
        return urlunparse(parsed._replace(query=urlencode(query_items)))

    # =================== OPENAI ===================
    # Optional: global fallback when user does not have BYOK configured
    OPENAI_API_KEY: str | None = None
    OPENAI_DEFAULT_MODEL: str = "gpt-4o-mini"

    # =================== RATE LIMITING ===================
    RATE_LIMIT_PER_MINUTE: int = 60

    # =================== SECURITY ===================
    # Chave for criptografia de data sensiveis (ex: Zotero API key)
    ENCRYPTION_KEY: str = "review_hub_default_key_change_me_in_production"

    # =================== LANGSMITH (OPCIONAL) ===================
    LANGCHAIN_TRACING_V2: bool = False
    LANGCHAIN_API_KEY: str | None = None
    LANGCHAIN_PROJECT: str = "review-hub"

    @property
    def supabase_env(self) -> str:
        """Return o ambiente do Supabase (local | production)."""
        value = (self.SUPABASE_ENV or "").strip().lower()
        return "local" if value == "local" else "production"


@lru_cache
def get_settings() -> Settings:
    """
    Return instance singleton of the configuracoes.

    Usa lru_cache for evitar re-parsing of the variaveis de ambiente.
    """
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
