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
