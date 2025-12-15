# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
Application Configuration.

Gerencia todas as configurações da aplicação via variáveis de ambiente
usando Pydantic Settings.
"""

from functools import lru_cache
from typing import Any

from pydantic import PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Configurações da aplicação carregadas de variáveis de ambiente.
    
    Todas as variáveis podem ser sobrescritas via .env ou environment.
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    # =================== APP ===================
    PROJECT_NAME: str = "Review Hub API"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    
    # =================== CORS ===================
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    
    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v
    
    # =================== SUPABASE ===================
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_ANON_KEY: str
    
    # =================== DATABASE ===================
    # Connection string do Postgres (Supabase ou local)
    DATABASE_URL: PostgresDsn
    
    @property
    def async_database_url(self) -> str:
        """Retorna a URL do banco para uso com asyncpg."""
        url = str(self.DATABASE_URL)
        return url.replace("postgresql://", "postgresql+asyncpg://")
    
    # =================== OPENAI ===================
    OPENAI_API_KEY: str
    OPENAI_DEFAULT_MODEL: str = "gpt-4o-mini"
    
    # =================== RATE LIMITING ===================
    RATE_LIMIT_PER_MINUTE: int = 60
    
    # =================== SECURITY ===================
    # Chave para criptografia de dados sensíveis (ex: Zotero API key)
    ENCRYPTION_KEY: str = "review_hub_default_key_change_me_in_production"
    
    # =================== LANGSMITH (OPCIONAL) ===================
    LANGCHAIN_TRACING_V2: bool = False
    LANGCHAIN_API_KEY: str | None = None
    LANGCHAIN_PROJECT: str = "review-hub"


@lru_cache
def get_settings() -> Settings:
    """
    Retorna instância singleton das configurações.
    
    Usa lru_cache para evitar re-parsing das variáveis de ambiente.
    """
    return Settings()  # type: ignore[call-arg]


settings = get_settings()

