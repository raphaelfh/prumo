"""
Application Configuration.

Manages todas as configuracoes da aplicacao via variaveis de ambiente
usando Pydantic Settings.
"""

from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config_validators import validate_linear_team_id


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
    PROJECT_NAME: str = "Prumo API"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # =================== CORS ===================
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:8080,http://127.0.0.1:8080,https://prumoai.vercel.app,https://prumo.vercel.app"

    @property
    def cors_origins_list(self) -> list[str]:
        """Return the CORS allow-list with a safe development fallback."""
        configured = [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]
        # Always-allowed origins so a stale CORS_ORIGINS env can never lock
        # out local dev or the canonical production frontend. The prod
        # origin (prumoai.vercel.app) is pinned here because env drift
        # between the Vercel domain and this list caused the 2026-05-31
        # extraction outage (preflights rejected as "Disallowed CORS origin").
        defaults = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "https://prumoai.vercel.app",
            "https://prumo.vercel.app",
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

    # =================== PARSING ===================
    # Standard self-hosted parser by default. Per-project activation can
    # request "llamaparse"; falls back to docling when no key is available.
    PARSER_BACKEND: str = "docling"
    # Optional global LlamaCloud key; per-user BYOK (APIKeyService) takes
    # precedence over this global fallback.
    LLAMA_CLOUD_API_KEY: str | None = None

    # =================== EVALUATION ===================
    EVALUATION_EVIDENCE_BUCKET: str = "articles"

    # =================== RATE LIMITING ===================
    RATE_LIMIT_PER_MINUTE: int = 60

    # =================== SECURITY ===================
    # Chave for criptografia de data sensiveis (ex: Zotero API key)
    ENCRYPTION_KEY: str = "review_hub_default_key_change_me_in_production"

    # =================== FEEDBACK / LINEAR ===================
    LINEAR_API_KEY: str | None = None
    LINEAR_TEAM_ID: str | None = None
    FEEDBACK_MEDIA_BUCKET: str = "feedback-media"
    FEEDBACK_MAX_IMAGE_BYTES: int = 10 * 1024 * 1024
    FEEDBACK_MAX_VIDEO_BYTES: int = 50 * 1024 * 1024

    @field_validator("LINEAR_TEAM_ID")
    @classmethod
    def _validate_linear_team_id(cls, value: str | None) -> str | None:
        """Fail fast at boot if LINEAR_TEAM_ID is set to the team slug, not its UUID."""
        return validate_linear_team_id(value)

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
