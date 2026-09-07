-- Supabase auth/storage stub for plain-Postgres databases.
--
-- Single source of truth for the bootstrap that CI's backend-test and
-- backend-e2e jobs apply to their scratch postgres:15 service container
-- (.github/workflows/ci.yml, "Bootstrap auth schema stub" steps), and that
-- the migration_db_url fixture in tests/integration/test_migration_roundtrip.py
-- applies to its ephemeral round-trip database. Idempotent: every statement
-- is IF NOT EXISTS / OR REPLACE / pg_roles-guarded, so applying it to a
-- database (or cluster) that already has the real Supabase objects is a no-op.

CREATE SCHEMA IF NOT EXISTS auth;
-- Supabase's auth.users carries far more columns (instance_id, aud,
-- role, encrypted_password, ...). Tests that exercise the JWT path
-- — notably test_membership_guards.outsider_user — insert with the
-- minimum useful subset, so mirror it in the stub.
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  instance_id UUID,
  aud TEXT,
  role TEXT
);
-- Stub auth.uid() and auth.role(): real implementations live in
-- Supabase's auth schema. They mirror Supabase's readers of the
-- request.jwt.* GUCs so RLS probes (set_config claims + SET LOCAL
-- ROLE authenticated, e.g. test_reviewer_ready_rls.py) authenticate
-- exactly as against a real Supabase Postgres; with no claims set
-- they return NULL, which is all `alembic upgrade head` needs.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    )
  $$;
-- Supabase pre-creates these roles; migrations GRANT to them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;
-- The RLS probes authenticate with `SET LOCAL ROLE authenticated`, which
-- needs membership in that role. Nothing grants it today because both
-- environments that run this file already have it: CI's container superuser
-- is an implicit member of everything, and Supabase's `postgres` -- which is
-- NOT a superuser -- is an explicit member of all three WITH ADMIN OPTION.
-- An ordinary owner on a plain-Postgres database is neither, so give it the
-- same membership rather than leaving the bootstrap dependent on who runs it.
--
-- The guard is load-bearing, not defensive dressing. A bare
-- `GRANT anon, authenticated, service_role TO CURRENT_USER` SEGFAULTS
-- Supabase's patched Postgres -- measured on 17.6: signal 11, every backend
-- terminated, cluster into crash recovery. supautils hooks GRANT for exactly
-- these three roles (`supautils.hint_roles`) and does not survive
-- CURRENT_USER in the grantee list. test_migration_roundtrip.py applies this
-- file to a scratch database on the developer's local Supabase cluster, so
-- unguarded it would take that whole stack down on every run.
-- `pg_has_role` is already true for a superuser and for Supabase's postgres,
-- so on both the GRANT is skipped and this block is a true no-op.
DO $$ BEGIN
  IF NOT pg_has_role(current_user, 'authenticated', 'MEMBER') THEN
    GRANT anon, authenticated, service_role TO CURRENT_USER;
  END IF;
END $$;
-- storage.objects stub: migration 0003 attaches RLS policies to it.
-- Columns mirror what the policies reference (bucket_id, name).
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT,
  name TEXT,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
