-- =====================================================
-- MIGRATION: handle_new_user trigger (auth.users → profiles)
-- =====================================================
-- Description: Creates the trigger that automatically inserts a row into
--              public.profiles whenever a new user signs up via Supabase Auth.
--
-- WHY this is a Supabase migration (not Alembic):
--   The CREATE TRIGGER statement targets auth.users, which lives in the
--   Supabase-managed auth schema. Alembic must never touch auth.* objects.
--   Supabase CLI applies this file before any Alembic migration runs.
--
-- NOTE: The handle_new_user() function itself is defined here (not in the
--   Alembic initial migration) because the trigger reference requires the
--   function to exist at the time the trigger is created.
-- =====================================================

-- =================== FUNCTION: handle_new_user ===================

CREATE
OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
INSERT INTO public.profiles (id, email, full_name)
VALUES (NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->>'full_name', ''));
RETURN NEW;
END;
$$;

COMMENT
ON FUNCTION public.handle_new_user() IS
'Trigger function that automatically creates a profile when a user is created in auth.users';

-- =================== TRIGGER: on_auth_user_created ===================
-- DROP-then-CREATE keeps the migration idempotent across re-runs (e.g. when
-- Supabase boots from a persisted Docker volume that already has the trigger).

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT
    ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
