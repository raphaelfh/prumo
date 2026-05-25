"""
Smoke tests for DEFERRED constraint triggers.

These tests use ``db_session_real`` (not the default SAVEPOINT-isolated
``db_session``) because the constraints they exercise fire at ``COMMIT``
time — a SAVEPOINT never reaches a real COMMIT, so the trigger would
never run.

Convention: one file per DEFERRED trigger. If you add a migration that
introduces a new ``CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED``,
add a matching file here.
"""
