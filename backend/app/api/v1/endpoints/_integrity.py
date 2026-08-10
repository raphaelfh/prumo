"""Truthful HTTP mapping for the one-live-run integrity backstop.

The one-live-run invariant is a partial unique index
(``uq_one_live_extraction_run_per_coord``, migration 0045): at most one
non-terminal run per (project, article, template, kind). Run creators normally
serialize on the (article, template) advisory lock taken in
``RunLifecycleService.resolve_or_create_extract_run`` and reuse the live run,
so the index fires only as a DB-level backstop on a path that skipped the lock.

When it *does* fire it must surface as **409 Conflict** — a run is already live
for the coordinate — on every create-run surface. Folding it into a generic
integrity mapping mislabels it: the raw create endpoint would call an FK
violation "run already in progress", the AI-extraction endpoint would call this
conflict "referenced row does not exist". Callers use ``is_one_live_run_conflict``
to branch the 409 out and keep their own (truthful) mapping for anything else.
"""

from sqlalchemy.exc import DBAPIError, IntegrityError

# Source of truth is the index in ``ExtractionRun.__table_args__`` (migration
# 0045). Duplicated here as a literal on purpose: the api layer must not import
# from app.models (check_layered_arch fitness function), and the name is frozen
# by a shipped migration.
ONE_LIVE_RUN_CONSTRAINT = "uq_one_live_extraction_run_per_coord"

# Client-facing 409 detail, shared so the message is identical whether the
# conflict is raised by the raw create endpoint or the AI-extraction gate.
ONE_LIVE_RUN_CONFLICT_DETAIL = (
    "An extraction run is already in progress for this article and "
    "template. Resume it (POST /api/v1/hitl/sessions) or cancel it "
    "before creating a new one."
)


def is_one_live_run_conflict(exc: IntegrityError) -> bool:
    """True when ``exc`` is the one-live-run unique-index violation (0045).

    asyncpg exposes the violated relation on ``constraint_name`` — reachable via
    ``exc.orig`` or its ``__cause__`` once SQLAlchemy's dbapi adapter wraps the
    driver error. Postgres reports a unique *index* violation with the index
    name in that field *and* in the message text, so we check the attribute
    first and fall back to the message: the classification holds regardless of
    how the driver/server surfaces the name.
    """
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if getattr(candidate, "constraint_name", None) == ONE_LIVE_RUN_CONSTRAINT:
            return True
    return ONE_LIVE_RUN_CONSTRAINT in str(orig or exc)


# --------------------------------------------------------------------------
# Deadlocks on the config-write path
# --------------------------------------------------------------------------

#: Postgres "deadlock detected". The transaction was chosen as the victim and
#: rolled back whole, so retrying is the correct and only response.
_DEADLOCK_SQLSTATE = "40P01"

DEADLOCK_RETRY_DETAIL = (
    "Someone else was editing this template at the same moment. Nothing was changed — try again."
)


def is_deadlock(exc: DBAPIError) -> bool:
    """True when ``exc`` is Postgres 40P01.

    Deliberately narrow. A serialization failure (40001) or an FK violation
    looks adjacent and is not the same promise: telling a user to retry
    something that will fail identically every time is worse than a 500,
    because it hides a real bug behind a friendly sentence.

    ``template_discard_service`` already makes this call for its own writes
    (``DiscardRacedError``); the B-7 structure endpoints take the SAME
    advisory locks through ``claim_draft_lock``, so they can lose the same
    race and owe the same answer.
    """
    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None)):
        if getattr(candidate, "sqlstate", None) == _DEADLOCK_SQLSTATE:
            return True
        if getattr(candidate, "pgcode", None) == _DEADLOCK_SQLSTATE:
            return True
    return False
