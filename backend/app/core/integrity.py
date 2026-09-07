"""Postgres integrity-error inspection, shared by services and endpoints.

``IntegrityError`` is how a constraint the schema enforces reaches Python;
mapping it to a typed domain error needs the violated constraint's NAME.
asyncpg exposes it on ``constraint_name`` — reachable via ``exc.orig`` or
its ``__cause__`` once SQLAlchemy's dbapi adapter wraps the driver error —
and Postgres always names it in the message text, which is the fallback.

The name is also the only stable signal. Postgres 18 gave ON DELETE
RESTRICT its own SQLSTATE, so a gate on the raw code silently stops
matching when the server is upgraded under it; the constraint name does
not move. Prefer ``violates_constraint`` — reach for
``FK_VIOLATION_SQLSTATES`` only where the code itself is the question.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

#: Both SQLSTATEs Postgres uses for "a foreign key still references this
#: row". Measured on the same DDL and the same DELETE:
#:
#:     PG 17.6 -> ForeignKeyViolationError, 23503 (foreign_key_violation)
#:     PG 18.6 -> RestrictViolationError,   23001 (restrict_violation)
#:
#: The server version alone decides which arrives, so a gate that accepts
#: only 23503 stops mapping the moment the database is upgraded.
FK_VIOLATION_SQLSTATES = frozenset({"23503", "23001"})


def violates_constraint(exc: IntegrityError, *names: str) -> bool:
    """True when ``exc`` is a violation of any constraint in ``names``."""
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if getattr(candidate, "constraint_name", None) in names:
            return True
    text = str(orig or exc)
    return any(name in text for name in names)
