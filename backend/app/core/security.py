"""
Security Module - JWT Validation with Supabase Auth.

Este módulo implementa validação de JWT compatível com:
- Supabase Cloud (RS256 via JWKS)
- Supabase Local (HS256 via JWT_SECRET)

Referência: https://supabase.com/docs/guides/auth/jwts
"""

import hashlib
from datetime import datetime, timedelta
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Security scheme para extrair Bearer token
# FastAPI gera automaticamente o security scheme no OpenAPI
security = HTTPBearer(
    scheme_name="Supabase JWT",
    description="JWT token do Supabase Auth",
)

# JWT Secret para Supabase local (HS256)
# Em produção, JWKS é usado (RS256)
SUPABASE_LOCAL_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"


class TokenPayload(BaseModel):
    """
    Payload extraído do JWT do Supabase.
    
    Contém claims padrão do Supabase Auth.
    """
    
    sub: str  # User ID (UUID)
    email: str | None = None
    phone: str | None = None
    role: str = "authenticated"
    aal: str = "aal1"  # Authenticator Assurance Level
    session_id: str | None = None
    
    # Timestamps
    iat: int | None = None  # Issued at
    exp: int | None = None  # Expiration
    
    # App metadata
    app_metadata: dict[str, Any] | None = None
    user_metadata: dict[str, Any] | None = None


class JWKSCache:
    """
    Cache para JWKS do Supabase.
    
    Evita requisições repetidas ao endpoint JWKS mantendo
    as chaves em cache por um período configurável.
    """
    
    def __init__(self, ttl_seconds: int = 300):
        self._jwks: dict[str, Any] | None = None
        self._expires_at: datetime | None = None
        self._ttl = timedelta(seconds=ttl_seconds)
    
    async def get_jwks(self, jwks_url: str) -> dict[str, Any]:
        """
        Retorna JWKS, buscando do endpoint se cache expirado.
        
        Args:
            jwks_url: URL do endpoint JWKS.
            
        Returns:
            Dict com as chaves públicas (JWKS).
        """
        now = datetime.utcnow()
        
        if self._jwks and self._expires_at and now < self._expires_at:
            return self._jwks
        
        async with httpx.AsyncClient() as client:
            response = await client.get(jwks_url, timeout=10.0)
            response.raise_for_status()
            self._jwks = response.json()
            self._expires_at = now + self._ttl
        
        return self._jwks
    
    def invalidate(self) -> None:
        """Invalida o cache forçando nova busca."""
        self._jwks = None
        self._expires_at = None


# Instância global do cache
_jwks_cache = JWKSCache()


async def get_jwks() -> dict[str, Any]:
    """
    Busca JWKS do Supabase com cache.
    
    Returns:
        Dict com as chaves públicas JWKS.
    """
    jwks_url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    return await _jwks_cache.get_jwks(jwks_url)


def _is_local_supabase() -> bool:
    """Verifica se está usando Supabase local."""
    return "127.0.0.1" in settings.SUPABASE_URL or "localhost" in settings.SUPABASE_URL


async def verify_supabase_jwt(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenPayload:
    """
    Valida JWT do Supabase Auth.
    
    Suporta dois modos:
    - Supabase Cloud: Validação via JWKS (RS256)
    - Supabase Local: Validação via JWT_SECRET (HS256)
    
    Args:
        credentials: Credenciais extraídas do header Authorization.
        
    Returns:
        TokenPayload com dados do usuário.
        
    Raises:
        HTTPException 401: Token inválido ou expirado.
    """
    token = credentials.credentials
    
    try:
        # Decodificar header sem verificar para pegar algoritmo
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        alg = unverified_header.get("alg", "HS256")
        
        # Supabase Local usa HS256 com JWT_SECRET
        if alg == "HS256" or _is_local_supabase():
            logger.debug("jwt_validation_mode", mode="HS256", is_local=True)
            payload = jwt.decode(
                token,
                SUPABASE_LOCAL_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=f"{settings.SUPABASE_URL}/auth/v1",
            )
            return TokenPayload(**payload)
        
        # Supabase Cloud usa RS256 com JWKS
        logger.debug("jwt_validation_mode", mode="RS256", kid=kid)
        
        # Buscar JWKS
        jwks = await get_jwks()
        
        # Encontrar chave correspondente
        rsa_key: dict[str, Any] | None = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                rsa_key = key
                break
        
        if not rsa_key:
            # Fallback para HS256 se JWKS estiver vazio (desenvolvimento)
            if not jwks.get("keys"):
                logger.warning("jwks_empty_fallback_hs256")
                payload = jwt.decode(
                    token,
                    SUPABASE_LOCAL_JWT_SECRET,
                    algorithms=["HS256"],
                    audience="authenticated",
                    issuer=f"{settings.SUPABASE_URL}/auth/v1",
                )
                return TokenPayload(**payload)
            
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token signing key not found",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Verificar e decodificar token com RS256
        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=[alg],
            audience="authenticated",
            issuer=f"{settings.SUPABASE_URL}/auth/v1",
        )
        
        return TokenPayload(**payload)
        
    except JWTError as e:
        logger.warning("jwt_validation_error", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e


# Alias para uso mais legível
get_current_user = verify_supabase_jwt


async def get_current_active_user(
    user: TokenPayload = Depends(get_current_user),
) -> TokenPayload:
    """
    Retorna usuário atual verificando se está ativo.
    
    Pode ser expandido para verificar status do usuário no banco.
    """
    # Verificar se token não expirou (já feito pelo jwt.decode, mas double-check)
    if user.exp:
        exp_datetime = datetime.fromtimestamp(user.exp)
        if datetime.utcnow() > exp_datetime:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token expired",
                headers={"WWW-Authenticate": "Bearer"},
            )
    
    return user


def require_aal2(user: TokenPayload = Depends(get_current_user)) -> TokenPayload:
    """
    Dependency que exige MFA (AAL2).
    
    Use em endpoints que requerem autenticação multi-fator.
    """
    if user.aal != "aal2":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Multi-factor authentication required",
        )
    return user


# =================== ENCRYPTION UTILS ===================

def derive_encryption_key(user_id: str) -> bytes:
    """
    Deriva chave de criptografia única por usuário.
    
    Usado para criptografar dados sensíveis como API keys.
    
    Args:
        user_id: ID do usuário para derivar chave.
        
    Returns:
        Bytes da chave derivada.
    """
    combined = f"{settings.ENCRYPTION_KEY}{user_id}".encode()
    return hashlib.pbkdf2_hmac(
        "sha256",
        combined,
        b"review_hub_salt",
        100000,
        dklen=32,
    )

