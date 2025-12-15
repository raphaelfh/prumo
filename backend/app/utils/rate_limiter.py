# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
Rate Limiter.

Configuração do SlowAPI para rate limiting.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings

# Limiter global usando IP como chave
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
)

