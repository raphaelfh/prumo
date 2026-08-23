"""Postgres integrity-error inspection, shared by services and endpoints.

``IntegrityError`` is how a constraint the schema enforces reaches Python;
mapping it to a typed domain error needs the violated constraint's NAME.
asyncpg exposes it on ``constraint_name`` — reachable via ``exc.orig`` or
its ``__cause__`` once SQLAlchemy's dbapi adapter wraps the driver error —
and Postgres always names it in the message text, which is the fallback.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError


def violates_constraint(exc: IntegrityError, *names: str) -> bool:
    """True when ``exc`` is a violation of any constraint in ``names``."""
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if getattr(candidate, "constraint_name", None) in names:
            return True
    text = str(orig or exc)
    return any(name in text for name in names)
