"""Drop user_api_keys and project_llm_endpoints; strip llm_engine.alternates.

llm_connections (0072) replaced both credential tables and every reader
has moved (slice-2 plan tasks 5-15). No active users exist, so the rows
are dropped, not migrated (spec §Non-goals). What falls with each table:
its PK, FKs, CHECKs, indexes, triggers, RLS policies and grants. The
trigger FUNCTION ensure_single_default_api_key() is a separate object and
is dropped explicitly (its grants fall with it); update_updated_at_column()
is shared by other tables and stays. alternates (retired fallback list,
spec §3.1) is removed from every projects.settings->'llm_engine' that
carries it — self-guarding SQL, a no-op on a row without the key.

Downgrade re-creates both tables' SCHEMA (baseline_v1.sql / 0055 shape,
with 0071's CHECK) and the trigger function, so ``downgrade -1`` works;
it never resurrects rows or alternates (data loss accepted, spec).

Revision ID: 0073_drop_legacy_credentials
Revises: 0072_llm_connections
Create Date: 2026-09-13
"""

from alembic import op

revision = "0073_drop_legacy_credentials"
down_revision = "0072_llm_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.project_llm_endpoints")
    op.execute("DROP TABLE IF EXISTS public.user_api_keys")
    op.execute("DROP FUNCTION IF EXISTS public.ensure_single_default_api_key()")
    # Self-guarding: only rows whose llm_engine carries the key are touched.
    op.execute(
        "UPDATE public.projects "
        "SET settings = jsonb_set(settings, '{llm_engine}', (settings->'llm_engine') - 'alternates') "
        "WHERE settings->'llm_engine' ? 'alternates'"
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION public.ensure_single_default_api_key() RETURNS trigger
            LANGUAGE plpgsql
            SET search_path = public, pg_catalog
            AS $$
            BEGIN
              IF NEW.is_default THEN
                UPDATE user_api_keys SET is_default = false
                WHERE user_id = NEW.user_id AND provider = NEW.provider AND id != NEW.id;
              END IF;
              RETURN NEW;
            END;
            $$;
        """
    )
    op.execute(
        """
        CREATE TABLE public.user_api_keys (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            provider text NOT NULL,
            encrypted_api_key text NOT NULL,
            key_name text,
            is_active boolean DEFAULT true NOT NULL,
            is_default boolean DEFAULT false NOT NULL,
            last_used_at timestamp with time zone,
            last_validated_at timestamp with time zone,
            validation_status text,
            metadata jsonb,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT user_api_keys_pkey PRIMARY KEY (id),
            CONSTRAINT user_api_keys_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES public.profiles(id) ON DELETE CASCADE,
            CONSTRAINT user_api_keys_provider_check CHECK (
                provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')),
            CONSTRAINT user_api_keys_validation_status_check CHECK (
                validation_status IS NULL OR validation_status IN ('valid', 'invalid', 'pending'))
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_user_api_keys_provider ON public.user_api_keys USING btree (provider)"
    )
    op.execute(
        "CREATE INDEX idx_user_api_keys_user_id ON public.user_api_keys USING btree (user_id)"
    )
    op.execute(
        "CREATE TRIGGER trg_ensure_single_default_api_key BEFORE INSERT OR UPDATE OF is_default "
        "ON public.user_api_keys FOR EACH ROW EXECUTE FUNCTION public.ensure_single_default_api_key()"
    )
    op.execute(
        "CREATE TRIGGER trg_user_api_keys_updated_at BEFORE UPDATE ON public.user_api_keys "
        "FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()"
    )
    op.execute("ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY")
    for verb, clause in (
        ("SELECT", "USING (user_id = auth.uid())"),
        ("INSERT", "WITH CHECK (user_id = auth.uid())"),
        ("UPDATE", "USING (user_id = auth.uid())"),
        ("DELETE", "USING (user_id = auth.uid())"),
    ):
        op.execute(
            f'CREATE POLICY "user_api_keys_{verb.lower()}" ON public.user_api_keys FOR {verb} {clause}'
        )
    op.execute("GRANT ALL ON TABLE public.user_api_keys TO authenticated, service_role")

    op.execute(
        """
        CREATE TABLE public.project_llm_endpoints (
            id uuid NOT NULL,
            project_id uuid NOT NULL,
            label text NOT NULL,
            base_url text NOT NULL,
            encrypted_api_key text,
            allowed_models jsonb DEFAULT '[]'::jsonb NOT NULL,
            capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
            validation_status text DEFAULT 'unverified' NOT NULL,
            last_validated_at timestamp with time zone,
            created_by uuid NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT project_llm_endpoints_pkey PRIMARY KEY (id),
            CONSTRAINT project_llm_endpoints_project_id_fkey FOREIGN KEY (project_id)
                REFERENCES public.projects(id) ON DELETE CASCADE,
            CONSTRAINT project_llm_endpoints_created_by_fkey FOREIGN KEY (created_by)
                REFERENCES public.profiles(id) ON DELETE RESTRICT,
            CONSTRAINT uq_llm_endpoint_label UNIQUE (project_id, label),
            CONSTRAINT ck_project_llm_endpoints_llm_ep_vstatus CHECK (
                validation_status IN ('unverified','ok','failed'))
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_public_project_llm_endpoints_project_id "
        "ON public.project_llm_endpoints USING btree (project_id)"
    )
    op.execute("ALTER TABLE public.project_llm_endpoints ENABLE ROW LEVEL SECURITY")
    op.execute('CREATE POLICY "deny_all" ON public.project_llm_endpoints FOR ALL USING (false)')
    op.execute("REVOKE ALL ON public.project_llm_endpoints FROM authenticated, anon")
