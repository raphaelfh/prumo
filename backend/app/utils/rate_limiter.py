"""
Rate Limiter.

Configuracao do SlowAPI for rate limiting.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

# Limiter global usando IP como key
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
)
