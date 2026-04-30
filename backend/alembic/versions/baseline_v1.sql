




CREATE SCHEMA IF NOT EXISTS "public";




CREATE TYPE "public"."consensus_rule" AS ENUM (
    'unanimous',
    'majority',
    'arbitrator'
);




CREATE TYPE "public"."extraction_cardinality" AS ENUM (
    'one',
    'many'
);




CREATE TYPE "public"."extraction_consensus_mode" AS ENUM (
    'select_existing',
    'manual_override'
);




CREATE TYPE "public"."extraction_field_type" AS ENUM (
    'text',
    'number',
    'date',
    'select',
    'multiselect',
    'boolean'
);




CREATE TYPE "public"."extraction_framework" AS ENUM (
    'CHARMS',
    'PICOS',
    'CUSTOM'
);




CREATE TYPE "public"."extraction_instance_status" AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'reviewed',
    'archived'
);




CREATE TYPE "public"."extraction_proposal_source" AS ENUM (
    'ai',
    'human',
    'system'
);




CREATE TYPE "public"."extraction_reviewer_decision" AS ENUM (
    'accept_proposal',
    'reject',
    'edit'
);




CREATE TYPE "public"."extraction_run_stage" AS ENUM (
    'pending',
    'proposal',
    'review',
    'consensus',
    'finalized',
    'cancelled'
);




CREATE TYPE "public"."extraction_run_status" AS ENUM (
    'pending',
    'running',
    'completed',
    'failed'
);




CREATE TYPE "public"."extraction_source" AS ENUM (
    'human',
    'ai',
    'rule'
);




CREATE TYPE "public"."file_role" AS ENUM (
    'MAIN',
    'SUPPLEMENT',
    'PROTOCOL',
    'DATASET',
    'APPENDIX',
    'FIGURE',
    'OTHER'
);




CREATE TYPE "public"."hitl_config_scope_kind" AS ENUM (
    'project',
    'template'
);




CREATE TYPE "public"."project_member_role" AS ENUM (
    'manager',
    'reviewer',
    'viewer',
    'consensus'
);




CREATE TYPE "public"."review_type" AS ENUM (
    'interventional',
    'predictive_model',
    'diagnostic',
    'prognostic',
    'qualitative',
    'other'
);




CREATE TYPE "public"."template_kind" AS ENUM (
    'extraction',
    'quality_assessment'
);




CREATE OR REPLACE FUNCTION "public"."calculate_model_progress"("p_project_id" "uuid", "p_article_id" "uuid") RETURNS TABLE("extraction_instance_id" "uuid", "entity_type_name" character varying, "total_fields" integer, "filled_fields" integer, "completion_percentage" numeric)
    LANGUAGE "plpgsql" STABLE
    AS $$
          BEGIN
          RETURN QUERY
          SELECT ei.id   AS extraction_instance_id,
                 et.name AS entity_type_name,
                 COUNT(ef.id)::integer AS total_fields, COUNT(ev.id)::integer AS filled_fields, CASE
                                                                                                    WHEN COUNT(ef.id) = 0
                                                                                                        THEN 0::numeric(5,2)
                    ELSE ROUND((COUNT(ev.id)::numeric / COUNT(ef.id)::numeric) * 100, 2)
          END
          AS completion_percentage
            FROM extraction_instances ei
            JOIN extraction_entity_types et ON et.id = ei.entity_type_id
            JOIN extraction_fields ef ON ef.entity_type_id = et.id
            LEFT JOIN extracted_values ev ON ev.instance_id = ei.id AND ev.field_id = ef.id
            WHERE ei.project_id = p_project_id
              AND ei.article_id = p_article_id
            GROUP BY ei.id, et.name;
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."check_cardinality_one"("p_article_id" "uuid", "p_entity_type_id" "uuid", "p_parent_instance_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
        DECLARE
            v_cardinality extraction_cardinality;
            v_parent_key UUID := COALESCE(p_parent_instance_id, '00000000-0000-0000-0000-000000000000'::uuid);
        BEGIN
            PERFORM pg_advisory_xact_lock(hashtextextended(
                p_article_id::text || ':' || p_entity_type_id::text || ':' || v_parent_key::text,
                0
            ));

            SELECT et.cardinality
            INTO v_cardinality
            FROM public.extraction_entity_types et
            WHERE et.id = p_entity_type_id;

            IF v_cardinality IS DISTINCT FROM 'one' THEN
                RETURN TRUE;
            END IF;

            RETURN NOT EXISTS (
                SELECT 1
                FROM public.extraction_instances ei
                WHERE ei.article_id = p_article_id
                  AND ei.entity_type_id = p_entity_type_id
                  AND ei.parent_instance_id IS NOT DISTINCT FROM p_parent_instance_id
            );
        END;
        $$;




CREATE OR REPLACE FUNCTION "public"."create_project_with_member"("p_name" "text", "p_description" "text" DEFAULT NULL::"text", "p_review_type" "public"."review_type" DEFAULT 'other'::"public"."review_type", "p_created_by" "uuid" DEFAULT "auth"."uid"()) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
        DECLARE
          v_project_id uuid;
          BEGIN
          INSERT INTO projects (name, description, review_type, created_by_id)
          VALUES (p_name, p_description, p_review_type, p_created_by) RETURNING id
          INTO v_project_id;

          INSERT INTO project_members (project_id, user_id, role)
          VALUES (v_project_id, p_created_by, 'manager');

          RETURN v_project_id;
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."enforce_consensus_override_justification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
        BEGIN
            IF NEW.mode = 'manual_override'
                AND (NEW.override_justification IS NULL OR btrim(NEW.override_justification) = '') THEN
                RAISE EXCEPTION 'Override justification is required for manual override mode'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$;




CREATE OR REPLACE FUNCTION "public"."enforce_extraction_instance_cardinality"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
        DECLARE
            v_cardinality extraction_cardinality;
            v_parent_key UUID := COALESCE(NEW.parent_instance_id, '00000000-0000-0000-0000-000000000000'::uuid);
        BEGIN
            IF NEW.article_id IS NULL THEN
                RETURN NEW;
            END IF;

            SELECT et.cardinality
            INTO v_cardinality
            FROM public.extraction_entity_types et
            WHERE et.id = NEW.entity_type_id;

            IF v_cardinality IS DISTINCT FROM 'one' THEN
                RETURN NEW;
            END IF;

            PERFORM pg_advisory_xact_lock(hashtextextended(
                NEW.article_id::text || ':' || NEW.entity_type_id::text || ':' || v_parent_key::text,
                0
            ));

            IF EXISTS (
                SELECT 1
                FROM public.extraction_instances ei
                WHERE ei.article_id = NEW.article_id
                  AND ei.entity_type_id = NEW.entity_type_id
                  AND ei.parent_instance_id IS NOT DISTINCT FROM NEW.parent_instance_id
                  AND (TG_OP = 'INSERT' OR ei.id <> NEW.id)
            ) THEN
                RAISE EXCEPTION 'Cardinality violation: only one extraction instance is allowed for this entity/article/parent context.'
                    USING ERRCODE = '23505';
            END IF;

            RETURN NEW;
        END;
        $$;




CREATE OR REPLACE FUNCTION "public"."ensure_single_default_api_key"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
          BEGIN
            IF
          NEW.is_default THEN
          UPDATE user_api_keys
          SET is_default = false
          WHERE user_id = NEW.user_id
            AND provider = NEW.provider
            AND id != NEW.id;
          END IF;
          RETURN NEW;
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."find_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
          BEGIN
          RETURN (SELECT id
                  FROM auth.users
                  WHERE email = p_email LIMIT 1);
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."get_project_members"("p_project_id" "uuid") RETURNS TABLE("id" "uuid", "user_id" "uuid", "role" "public"."project_member_role", "permissions" "jsonb", "created_at" timestamp with time zone, "user_email" "text", "user_full_name" "text", "user_avatar_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
               BEGIN
               RETURN QUERY
               SELECT pm.id,
                      pm.user_id,
                      pm.role,
                      pm.permissions,
                      pm.created_at,
                      u.email::text      AS user_email, p.full_name::text  AS user_full_name, p.avatar_url::text AS user_avatar_url
               FROM project_members pm
                        JOIN auth.users u ON u.id = pm.user_id
                        LEFT JOIN profiles p ON p.id = pm.user_id
               WHERE pm.project_id = p_project_id;
               END;
        $$;




CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
INSERT INTO public.profiles (id, email, full_name)
VALUES (NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->>'full_name', ''));
RETURN NEW;
END;
$$;




COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Trigger function that automatically creates a profile when a user is created in auth.users';



CREATE OR REPLACE FUNCTION "public"."is_project_manager"("p_project_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
          BEGIN
          RETURN EXISTS (SELECT 1
                         FROM project_members
                         WHERE project_id = p_project_id
                           AND user_id = p_user_id
                           AND role = 'manager');
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
          BEGIN
          RETURN EXISTS (SELECT 1
                         FROM project_members
                         WHERE project_id = p_project_id
                           AND user_id = p_user_id);
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."is_project_reviewer"("p_project_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
        BEGIN
            RETURN EXISTS (
                SELECT 1 FROM project_members
                WHERE project_id = p_project_id
                  AND user_id = p_user_id
                  AND role IN ('manager', 'reviewer', 'consensus')
            );
        END;
        $$;




CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
          BEGIN
            NEW.updated_at
          = NOW();
          RETURN NEW;
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
          BEGIN
            NEW.updated_at
          = NOW();
          RETURN NEW;
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."validate_extraction_instance_hierarchy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
        DECLARE
          v_parent extraction_instances
          %ROWTYPE;
          BEGIN
            IF
          NEW.parent_instance_id IS NULL THEN
                RETURN NEW;
          END IF;
          SELECT *
          INTO v_parent
          FROM extraction_instances
          WHERE id = NEW.parent_instance_id;
          IF
          NOT FOUND THEN
                RAISE EXCEPTION 'Parent instance % not found', NEW.parent_instance_id;
          END IF;
            IF
          v_parent.project_id != NEW.project_id THEN
                RAISE EXCEPTION 'Parent and child must belong to the same project';
          END IF;
            IF
          v_parent.article_id IS DISTINCT FROM NEW.article_id THEN
                RAISE EXCEPTION 'Parent and child must belong to the same article';
          END IF;
          RETURN NEW;
          END;
        $$;




CREATE OR REPLACE FUNCTION "public"."validate_instance_project_consistency"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
          BEGIN
            IF
          NOT EXISTS (
                SELECT 1 FROM projects
                WHERE id = NEW.project_id
            ) THEN
                RAISE EXCEPTION 'Project % does not exist', NEW.project_id;
          END IF;
          RETURN NEW;
          END;
        $$;










CREATE TABLE IF NOT EXISTS "public"."article_annotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "article_id" "uuid" NOT NULL,
    "article_file_id" "uuid",
    "user_id" "uuid",
    "page_number" integer,
    "position" "jsonb",
    "content" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."article_author_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "article_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "author_order" integer NOT NULL,
    "creator_type" "text" DEFAULT 'author'::"text" NOT NULL,
    "raw_creator_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."article_authors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "normalized_name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "orcid" "text",
    "source_hint" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."article_boxes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "article_id" "uuid" NOT NULL,
    "article_file_id" "uuid",
    "user_id" "uuid",
    "page_number" integer,
    "position" "jsonb",
    "label" character varying,
    "color" character varying DEFAULT 'blue'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."article_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "article_id" "uuid" NOT NULL,
    "file_type" character varying NOT NULL,
    "storage_key" "text" NOT NULL,
    "original_filename" "text",
    "bytes" bigint,
    "md5" "text",
    "file_role" "public"."file_role" DEFAULT 'MAIN'::"public"."file_role",
    "text_raw" "text",
    "text_html" "text",
    "extraction_status" character varying DEFAULT 'pending'::character varying,
    "extraction_error" "text",
    "extracted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."article_highlights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "article_id" "uuid" NOT NULL,
    "article_file_id" "uuid",
    "user_id" "uuid",
    "page_number" integer,
    "position" "jsonb",
    "highlighted_text" "text",
    "color" character varying DEFAULT 'yellow'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."article_sync_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "article_id" "uuid",
    "sync_run_id" "uuid" NOT NULL,
    "zotero_item_key" "text",
    "status" "text" NOT NULL,
    "authority_rule_applied" "text",
    "error_code" "text",
    "error_message" "text",
    "event_payload" "jsonb",
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."article_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "requested_by_user_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "source" "text" DEFAULT 'zotero'::"text" NOT NULL,
    "source_collection_key" "text",
    "total_received" integer DEFAULT 0 NOT NULL,
    "persisted" integer DEFAULT 0 NOT NULL,
    "updated" integer DEFAULT 0 NOT NULL,
    "skipped" integer DEFAULT 0 NOT NULL,
    "failed" integer DEFAULT 0 NOT NULL,
    "removed_at_source" integer DEFAULT 0 NOT NULL,
    "reactivated" integer DEFAULT 0 NOT NULL,
    "failure_summary" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."articles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "abstract" "text",
    "language" character varying,
    "publication_year" integer,
    "publication_month" integer,
    "publication_day" integer,
    "journal_title" "text",
    "journal_issn" character varying,
    "journal_eissn" character varying,
    "journal_publisher" "text",
    "volume" character varying,
    "issue" character varying,
    "pages" character varying,
    "article_type" character varying,
    "publication_status" character varying,
    "open_access" boolean,
    "license" character varying,
    "doi" "text",
    "pmid" "text",
    "pmcid" "text",
    "arxiv_id" "text",
    "pii" "text",
    "keywords" "text"[],
    "authors" "text"[],
    "mesh_terms" "text"[],
    "url_landing" "text",
    "url_pdf" "text",
    "study_design" character varying,
    "registration" "jsonb",
    "funding" "jsonb",
    "conflicts_of_interest" "text",
    "data_availability" "text",
    "hash_fingerprint" "text",
    "ingestion_source" character varying,
    "source_payload" "jsonb",
    "row_version" bigint DEFAULT 1 NOT NULL,
    "zotero_item_key" "text",
    "zotero_collection_key" "text",
    "zotero_version" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sync_state" "text" DEFAULT 'active'::"text" NOT NULL,
    "removed_at_source_at" timestamp with time zone,
    "last_synced_at" timestamp with time zone,
    "sync_conflict_log" "jsonb",
    "pdf_extracted_text" "text",
    "semantic_abstract_text" "text",
    "semantic_fulltext_text" "text",
    "source_lineage" "text"
);




CREATE TABLE IF NOT EXISTS "public"."extracted_values" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "article_id" "uuid" NOT NULL,
    "instance_id" "uuid" NOT NULL,
    "field_id" "uuid" NOT NULL,
    "value" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source" "public"."extraction_source" NOT NULL,
    "confidence_score" numeric,
    "evidence" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "reviewer_id" "uuid",
    "is_consensus" boolean DEFAULT false NOT NULL,
    "unit" character varying,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."extraction_consensus_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "instance_id" "uuid" NOT NULL,
    "field_id" "uuid" NOT NULL,
    "consensus_user_id" "uuid" NOT NULL,
    "mode" "public"."extraction_consensus_mode" NOT NULL,
    "selected_decision_id" "uuid",
    "value" "jsonb",
    "rationale" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_extraction_consensus_decisions_manual_override_complete" CHECK ((("mode" <> 'manual_override'::"public"."extraction_consensus_mode") OR (("value" IS NOT NULL) AND ("rationale" IS NOT NULL)))),
    CONSTRAINT "ck_extraction_consensus_decisions_select_existing_has_decision" CHECK ((("mode" <> 'select_existing'::"public"."extraction_consensus_mode") OR ("selected_decision_id" IS NOT NULL)))
);




CREATE TABLE IF NOT EXISTS "public"."extraction_entity_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid",
    "project_template_id" "uuid",
    "name" character varying NOT NULL,
    "label" character varying NOT NULL,
    "description" "text",
    "parent_entity_type_id" "uuid",
    "cardinality" "public"."extraction_cardinality" DEFAULT 'one'::"public"."extraction_cardinality" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_required" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_extraction_entity_types_template_xor" CHECK ((("template_id" IS NULL) <> ("project_template_id" IS NULL)))
);




CREATE TABLE IF NOT EXISTS "public"."extraction_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "article_id" "uuid" NOT NULL,
    "article_file_id" "uuid",
    "page_number" integer,
    "position" "jsonb",
    "text_content" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "run_id" "uuid",
    "proposal_record_id" "uuid",
    "reviewer_decision_id" "uuid",
    "consensus_decision_id" "uuid",
    CONSTRAINT "workflow_target_present" CHECK ((("run_id" IS NOT NULL) AND (("proposal_record_id" IS NOT NULL) OR ("reviewer_decision_id" IS NOT NULL) OR ("consensus_decision_id" IS NOT NULL))))
);




CREATE TABLE IF NOT EXISTS "public"."extraction_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type_id" "uuid" NOT NULL,
    "name" character varying NOT NULL,
    "label" character varying NOT NULL,
    "description" "text",
    "field_type" "public"."extraction_field_type" NOT NULL,
    "is_required" boolean DEFAULT false NOT NULL,
    "validation_schema" "jsonb",
    "allowed_values" "jsonb",
    "unit" character varying,
    "allowed_units" "jsonb",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "llm_description" "text",
    "allow_other" boolean DEFAULT false NOT NULL,
    "other_label" character varying,
    "other_placeholder" character varying,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."extraction_hitl_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_kind" "public"."hitl_config_scope_kind" NOT NULL,
    "scope_id" "uuid" NOT NULL,
    "reviewer_count" integer NOT NULL,
    "consensus_rule" "public"."consensus_rule" NOT NULL,
    "arbitrator_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_extraction_hitl_configs_arbitrator_required" CHECK ((("consensus_rule" <> 'arbitrator'::"public"."consensus_rule") OR ("arbitrator_id" IS NOT NULL))),
    CONSTRAINT "extraction_hitl_configs_reviewer_count_check" CHECK (("reviewer_count" >= 1))
);




CREATE TABLE IF NOT EXISTS "public"."extraction_instances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "article_id" "uuid",
    "template_id" "uuid" NOT NULL,
    "entity_type_id" "uuid" NOT NULL,
    "parent_instance_id" "uuid",
    "label" character varying NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "status" "public"."extraction_instance_status" DEFAULT 'pending'::"public"."extraction_instance_status" NOT NULL,
    "is_template" boolean,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."extraction_proposal_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "instance_id" "uuid" NOT NULL,
    "field_id" "uuid" NOT NULL,
    "source" "public"."extraction_proposal_source" NOT NULL,
    "source_user_id" "uuid",
    "proposed_value" "jsonb" NOT NULL,
    "confidence_score" numeric,
    "rationale" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_extraction_proposal_records_human_has_user" CHECK ((("source" <> 'human'::"public"."extraction_proposal_source") OR ("source_user_id" IS NOT NULL)))
);




CREATE TABLE IF NOT EXISTS "public"."extraction_published_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "instance_id" "uuid" NOT NULL,
    "field_id" "uuid" NOT NULL,
    "value" "jsonb" NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_by" "uuid" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."extraction_reviewer_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "instance_id" "uuid" NOT NULL,
    "field_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "decision" "public"."extraction_reviewer_decision" NOT NULL,
    "proposal_record_id" "uuid",
    "value" "jsonb",
    "rationale" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_extraction_reviewer_decisions_accept_has_proposal" CHECK ((("decision" <> 'accept_proposal'::"public"."extraction_reviewer_decision") OR ("proposal_record_id" IS NOT NULL))),
    CONSTRAINT "ck_extraction_reviewer_decisions_edit_has_value" CHECK ((("decision" <> 'edit'::"public"."extraction_reviewer_decision") OR ("value" IS NOT NULL)))
);




CREATE TABLE IF NOT EXISTS "public"."extraction_reviewer_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "instance_id" "uuid" NOT NULL,
    "field_id" "uuid" NOT NULL,
    "current_decision_id" "uuid" NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."extraction_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "article_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "stage" "public"."extraction_run_stage" DEFAULT 'pending'::"public"."extraction_run_stage" NOT NULL,
    "status" "public"."extraction_run_status" DEFAULT 'pending'::"public"."extraction_run_status" NOT NULL,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "results" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "public"."template_kind" DEFAULT 'extraction'::"public"."template_kind" NOT NULL,
    "version_id" "uuid" NOT NULL,
    "hitl_config_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);




COMMENT ON TABLE "public"."extraction_runs" IS 'Tracks AI extraction execution lifecycle.';



CREATE TABLE IF NOT EXISTS "public"."extraction_template_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_template_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "schema" "jsonb" NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_by" "uuid" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."extraction_templates_global" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying NOT NULL,
    "description" "text",
    "framework" "public"."extraction_framework" NOT NULL,
    "version" character varying DEFAULT '1.0.0'::character varying NOT NULL,
    "is_global" boolean DEFAULT true NOT NULL,
    "schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "public"."template_kind" DEFAULT 'extraction'::"public"."template_kind" NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."feedback_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "category" character varying NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" character varying DEFAULT 'open'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."migration_status" (
    "id" integer NOT NULL,
    "migration_name" character varying NOT NULL,
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text"
);




CREATE SEQUENCE IF NOT EXISTS "public"."migration_status_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."migration_status_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."migration_status_id_seq" OWNED BY "public"."migration_status"."id";



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




COMMENT ON TABLE "public"."profiles" IS 'Extended user profile data, keyed by auth.users.id.';



CREATE TABLE IF NOT EXISTS "public"."project_extraction_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "global_template_id" "uuid",
    "name" character varying NOT NULL,
    "description" "text",
    "framework" "public"."extraction_framework" NOT NULL,
    "version" character varying DEFAULT '1.0.0'::character varying NOT NULL,
    "schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "public"."template_kind" DEFAULT 'extraction'::"public"."template_kind" NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."project_member_role" DEFAULT 'reviewer'::"public"."project_member_role" NOT NULL,
    "permissions" "jsonb" DEFAULT '{"can_export": false}'::"jsonb" NOT NULL,
    "invitation_email" "text",
    "invitation_token" "text",
    "invitation_sent_at" timestamp with time zone,
    "invitation_accepted_at" timestamp with time zone,
    "created_by_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying NOT NULL,
    "description" "text",
    "created_by_id" "uuid" NOT NULL,
    "settings" "jsonb" DEFAULT '{"blind_mode": false}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "review_title" "text",
    "condition_studied" character varying,
    "review_rationale" "text",
    "review_keywords" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "eligibility_criteria" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "study_design" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "review_context" "text",
    "search_strategy" "text",
    "picots_config_ai_review" "jsonb",
    "review_type" "public"."review_type" DEFAULT 'interventional'::"public"."review_type",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




COMMENT ON TABLE "public"."projects" IS 'Systematic review projects.';



CREATE TABLE IF NOT EXISTS "public"."user_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "encrypted_api_key" "text" NOT NULL,
    "key_name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "last_used_at" timestamp with time zone,
    "last_validated_at" timestamp with time zone,
    "validation_status" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_api_keys_provider_check" CHECK (("provider" = ANY (ARRAY['openai'::"text", 'anthropic'::"text", 'gemini'::"text", 'grok'::"text"]))),
    CONSTRAINT "user_api_keys_validation_status_check" CHECK ((("validation_status" IS NULL) OR ("validation_status" = ANY (ARRAY['valid'::"text", 'invalid'::"text", 'pending'::"text"]))))
);




CREATE TABLE IF NOT EXISTS "public"."zotero_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "zotero_user_id" "text" NOT NULL,
    "library_type" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_sync_at" timestamp with time zone,
    "encrypted_api_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);




ALTER TABLE ONLY "public"."migration_status" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."migration_status_id_seq"'::"regclass");






ALTER TABLE ONLY "public"."article_annotations"
    ADD CONSTRAINT "article_annotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_author_links"
    ADD CONSTRAINT "article_author_links_article_id_author_id_creator_type_key" UNIQUE ("article_id", "author_id", "creator_type");



ALTER TABLE ONLY "public"."article_author_links"
    ADD CONSTRAINT "article_author_links_article_id_author_order_key" UNIQUE ("article_id", "author_order");



ALTER TABLE ONLY "public"."article_author_links"
    ADD CONSTRAINT "article_author_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_authors"
    ADD CONSTRAINT "article_authors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_boxes"
    ADD CONSTRAINT "article_boxes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_files"
    ADD CONSTRAINT "article_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_highlights"
    ADD CONSTRAINT "article_highlights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_sync_events"
    ADD CONSTRAINT "article_sync_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."article_sync_runs"
    ADD CONSTRAINT "article_sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extracted_values"
    ADD CONSTRAINT "extracted_values_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_consensus_decisions"
    ADD CONSTRAINT "extraction_consensus_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_entity_types"
    ADD CONSTRAINT "extraction_entity_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_fields"
    ADD CONSTRAINT "extraction_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_hitl_configs"
    ADD CONSTRAINT "extraction_hitl_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_instances"
    ADD CONSTRAINT "extraction_instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_proposal_records"
    ADD CONSTRAINT "extraction_proposal_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_published_states"
    ADD CONSTRAINT "extraction_published_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_reviewer_decisions"
    ADD CONSTRAINT "extraction_reviewer_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_reviewer_states"
    ADD CONSTRAINT "extraction_reviewer_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_template_versions"
    ADD CONSTRAINT "extraction_template_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_templates_global"
    ADD CONSTRAINT "extraction_templates_global_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_reports"
    ADD CONSTRAINT "feedback_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."migration_status"
    ADD CONSTRAINT "migration_status_migration_name_key" UNIQUE ("migration_name");



ALTER TABLE ONLY "public"."migration_status"
    ADD CONSTRAINT "migration_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_extraction_templates"
    ADD CONSTRAINT "project_extraction_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_hitl_configs"
    ADD CONSTRAINT "uq_extraction_hitl_configs_scope" UNIQUE ("scope_kind", "scope_id");



ALTER TABLE ONLY "public"."extraction_published_states"
    ADD CONSTRAINT "uq_extraction_published_states_run_item" UNIQUE ("run_id", "instance_id", "field_id");



ALTER TABLE ONLY "public"."extraction_reviewer_states"
    ADD CONSTRAINT "uq_extraction_reviewer_states_run_reviewer_item" UNIQUE ("run_id", "reviewer_id", "instance_id", "field_id");



ALTER TABLE ONLY "public"."extraction_template_versions"
    ADD CONSTRAINT "uq_extraction_template_versions_template_version" UNIQUE ("project_template_id", "version");



ALTER TABLE ONLY "public"."extraction_templates_global"
    ADD CONSTRAINT "uq_extraction_templates_global_id_kind" UNIQUE ("id", "kind");



ALTER TABLE ONLY "public"."project_extraction_templates"
    ADD CONSTRAINT "uq_project_extraction_templates_id_kind" UNIQUE ("id", "kind");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "uq_project_user" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zotero_integrations"
    ADD CONSTRAINT "zotero_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zotero_integrations"
    ADD CONSTRAINT "zotero_integrations_user_id_key" UNIQUE ("user_id");



CREATE INDEX "idx_article_author_links_article_id" ON "public"."article_author_links" USING "btree" ("article_id");



CREATE INDEX "idx_article_author_links_author_id" ON "public"."article_author_links" USING "btree" ("author_id");



CREATE INDEX "idx_article_authors_normalized_name" ON "public"."article_authors" USING "btree" ("normalized_name");



CREATE INDEX "idx_article_files_article_id" ON "public"."article_files" USING "btree" ("article_id");



CREATE INDEX "idx_article_files_article_role" ON "public"."article_files" USING "btree" ("article_id", "file_role");



CREATE INDEX "idx_article_files_project_id" ON "public"."article_files" USING "btree" ("project_id");



CREATE INDEX "idx_article_sync_events_project_id" ON "public"."article_sync_events" USING "btree" ("project_id");



CREATE INDEX "idx_article_sync_events_status" ON "public"."article_sync_events" USING "btree" ("status");



CREATE INDEX "idx_article_sync_events_sync_run_id" ON "public"."article_sync_events" USING "btree" ("sync_run_id");



CREATE INDEX "idx_article_sync_runs_project_id" ON "public"."article_sync_runs" USING "btree" ("project_id");



CREATE INDEX "idx_article_sync_runs_requested_by_user_id" ON "public"."article_sync_runs" USING "btree" ("requested_by_user_id");



CREATE INDEX "idx_article_sync_runs_status" ON "public"."article_sync_runs" USING "btree" ("status");



CREATE INDEX "idx_articles_biblio" ON "public"."articles" USING "btree" ("publication_year", "journal_title");



CREATE INDEX "idx_articles_doi" ON "public"."articles" USING "btree" ("doi") WHERE ("doi" IS NOT NULL);



CREATE INDEX "idx_articles_keywords" ON "public"."articles" USING "gin" ("keywords");



CREATE INDEX "idx_articles_last_synced_at" ON "public"."articles" USING "btree" ("last_synced_at" DESC);



CREATE INDEX "idx_articles_mesh" ON "public"."articles" USING "gin" ("mesh_terms");



CREATE INDEX "idx_articles_pmid" ON "public"."articles" USING "btree" ("pmid") WHERE ("pmid" IS NOT NULL);



CREATE INDEX "idx_articles_project_id" ON "public"."articles" USING "btree" ("project_id");



CREATE INDEX "idx_articles_source_payload_gin" ON "public"."articles" USING "gin" ("source_payload");



CREATE INDEX "idx_articles_sync_state" ON "public"."articles" USING "btree" ("sync_state");



CREATE INDEX "idx_articles_trgm_title" ON "public"."articles" USING "gin" ("title" "public"."gin_trgm_ops");



CREATE INDEX "idx_extracted_values_article_id" ON "public"."extracted_values" USING "btree" ("article_id");



CREATE INDEX "idx_extracted_values_evidence_gin" ON "public"."extracted_values" USING "gin" ("evidence");



CREATE INDEX "idx_extracted_values_field_id" ON "public"."extracted_values" USING "btree" ("field_id");



CREATE INDEX "idx_extracted_values_instance_field" ON "public"."extracted_values" USING "btree" ("instance_id", "field_id");



CREATE INDEX "idx_extracted_values_instance_id" ON "public"."extracted_values" USING "btree" ("instance_id");



CREATE INDEX "idx_extracted_values_project_id" ON "public"."extracted_values" USING "btree" ("project_id");



CREATE INDEX "idx_extracted_values_value_gin" ON "public"."extracted_values" USING "gin" ("value");



CREATE INDEX "idx_extraction_consensus_decisions_run_id" ON "public"."extraction_consensus_decisions" USING "btree" ("run_id");



CREATE INDEX "idx_extraction_consensus_decisions_run_item" ON "public"."extraction_consensus_decisions" USING "btree" ("run_id", "instance_id", "field_id");



CREATE INDEX "idx_extraction_entity_types_parent" ON "public"."extraction_entity_types" USING "btree" ("parent_entity_type_id") WHERE ("parent_entity_type_id" IS NOT NULL);



CREATE INDEX "idx_extraction_entity_types_template" ON "public"."extraction_entity_types" USING "btree" ("template_id");



CREATE INDEX "idx_extraction_evidence_article_id" ON "public"."extraction_evidence" USING "btree" ("article_id");



CREATE INDEX "idx_extraction_evidence_position_gin" ON "public"."extraction_evidence" USING "gin" ("position");



CREATE INDEX "idx_extraction_evidence_project_id" ON "public"."extraction_evidence" USING "btree" ("project_id");



CREATE INDEX "idx_extraction_evidence_run_id" ON "public"."extraction_evidence" USING "btree" ("run_id");



CREATE INDEX "idx_extraction_fields_entity_type" ON "public"."extraction_fields" USING "btree" ("entity_type_id");



CREATE INDEX "idx_extraction_hitl_configs_scope" ON "public"."extraction_hitl_configs" USING "btree" ("scope_kind", "scope_id");



CREATE INDEX "idx_extraction_instances_article" ON "public"."extraction_instances" USING "btree" ("article_id");



CREATE INDEX "idx_extraction_instances_article_entity_sort" ON "public"."extraction_instances" USING "btree" ("article_id", "entity_type_id", "sort_order");



CREATE INDEX "idx_extraction_instances_entity_type" ON "public"."extraction_instances" USING "btree" ("entity_type_id");



CREATE INDEX "idx_extraction_instances_metadata_gin" ON "public"."extraction_instances" USING "gin" ("metadata");



CREATE INDEX "idx_extraction_instances_parent" ON "public"."extraction_instances" USING "btree" ("parent_instance_id") WHERE ("parent_instance_id" IS NOT NULL);



CREATE INDEX "idx_extraction_instances_project" ON "public"."extraction_instances" USING "btree" ("project_id");



CREATE INDEX "idx_extraction_instances_status" ON "public"."extraction_instances" USING "btree" ("status");



CREATE INDEX "idx_extraction_instances_template" ON "public"."extraction_instances" USING "btree" ("template_id");



CREATE INDEX "idx_extraction_proposal_records_instance_id" ON "public"."extraction_proposal_records" USING "btree" ("instance_id");



CREATE INDEX "idx_extraction_proposal_records_run_id" ON "public"."extraction_proposal_records" USING "btree" ("run_id");



CREATE INDEX "idx_extraction_proposal_records_run_item" ON "public"."extraction_proposal_records" USING "btree" ("run_id", "instance_id", "field_id");



CREATE INDEX "idx_extraction_reviewer_decisions_run_id" ON "public"."extraction_reviewer_decisions" USING "btree" ("run_id");



CREATE INDEX "idx_extraction_reviewer_decisions_run_reviewer_item" ON "public"."extraction_reviewer_decisions" USING "btree" ("run_id", "reviewer_id", "instance_id", "field_id", "created_at");



CREATE INDEX "idx_extraction_runs_article" ON "public"."extraction_runs" USING "btree" ("article_id");



CREATE INDEX "idx_extraction_runs_kind" ON "public"."extraction_runs" USING "btree" ("kind");



CREATE INDEX "idx_extraction_runs_parameters_gin" ON "public"."extraction_runs" USING "gin" ("parameters");



CREATE INDEX "idx_extraction_runs_project" ON "public"."extraction_runs" USING "btree" ("project_id");



CREATE INDEX "idx_extraction_runs_results_gin" ON "public"."extraction_runs" USING "gin" ("results");



CREATE INDEX "idx_extraction_runs_status_stage" ON "public"."extraction_runs" USING "btree" ("status", "stage");



CREATE INDEX "idx_extraction_runs_template" ON "public"."extraction_runs" USING "btree" ("template_id");



CREATE UNIQUE INDEX "idx_extraction_template_versions_active" ON "public"."extraction_template_versions" USING "btree" ("project_template_id") WHERE "is_active";



CREATE INDEX "idx_extraction_template_versions_template" ON "public"."extraction_template_versions" USING "btree" ("project_template_id");



CREATE INDEX "idx_extraction_templates_global_schema_gin" ON "public"."extraction_templates_global" USING "gin" ("schema");



CREATE INDEX "idx_project_extraction_templates_project_id" ON "public"."project_extraction_templates" USING "btree" ("project_id");



CREATE INDEX "idx_project_extraction_templates_schema_gin" ON "public"."project_extraction_templates" USING "gin" ("schema");



CREATE INDEX "idx_project_members_project_id" ON "public"."project_members" USING "btree" ("project_id");



CREATE INDEX "idx_project_members_user_id" ON "public"."project_members" USING "btree" ("user_id");



CREATE INDEX "idx_projects_created_by_id" ON "public"."projects" USING "btree" ("created_by_id");



CREATE INDEX "idx_projects_eligibility_criteria_gin" ON "public"."projects" USING "gin" ("eligibility_criteria");



CREATE INDEX "idx_projects_review_keywords_gin" ON "public"."projects" USING "gin" ("review_keywords");



CREATE INDEX "idx_projects_settings_gin" ON "public"."projects" USING "gin" ("settings");



CREATE INDEX "idx_projects_study_design_gin" ON "public"."projects" USING "gin" ("study_design");



CREATE INDEX "idx_user_api_keys_provider" ON "public"."user_api_keys" USING "btree" ("provider");



CREATE INDEX "idx_user_api_keys_user_id" ON "public"."user_api_keys" USING "btree" ("user_id");



CREATE UNIQUE INDEX "uq_article_authors_normalized_orcid" ON "public"."article_authors" USING "btree" ("normalized_name", COALESCE("orcid", ''::"text"));



CREATE UNIQUE INDEX "uq_articles_project_zotero_item" ON "public"."articles" USING "btree" ("project_id", "zotero_item_key") WHERE ("zotero_item_key" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_article_annotations_updated_at" BEFORE UPDATE ON "public"."article_annotations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_article_files_updated_at" BEFORE UPDATE ON "public"."article_files" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_articles_updated_at" BEFORE UPDATE ON "public"."articles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_enforce_extraction_instance_cardinality" BEFORE INSERT OR UPDATE OF "article_id", "entity_type_id", "parent_instance_id" ON "public"."extraction_instances" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_extraction_instance_cardinality"();



CREATE OR REPLACE TRIGGER "trg_ensure_single_default_api_key" BEFORE INSERT OR UPDATE OF "is_default" ON "public"."user_api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_single_default_api_key"();



CREATE OR REPLACE TRIGGER "trg_extracted_values_updated_at" BEFORE UPDATE ON "public"."extracted_values" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_extraction_entity_types_updated_at" BEFORE UPDATE ON "public"."extraction_entity_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_extraction_evidence_updated_at" BEFORE UPDATE ON "public"."extraction_evidence" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_extraction_fields_updated_at" BEFORE UPDATE ON "public"."extraction_fields" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_extraction_instances_updated_at" BEFORE UPDATE ON "public"."extraction_instances" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_extraction_templates_global_updated_at" BEFORE UPDATE ON "public"."extraction_templates_global" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_feedback_reports_updated_at" BEFORE UPDATE ON "public"."feedback_reports" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_project_extraction_templates_updated_at" BEFORE UPDATE ON "public"."project_extraction_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_project_members_updated_at" BEFORE UPDATE ON "public"."project_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_user_api_keys_updated_at" BEFORE UPDATE ON "public"."user_api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_validate_extraction_hierarchy" BEFORE INSERT OR UPDATE OF "parent_instance_id", "project_id", "article_id" ON "public"."extraction_instances" FOR EACH ROW EXECUTE FUNCTION "public"."validate_extraction_instance_hierarchy"();



CREATE OR REPLACE TRIGGER "trg_zotero_integrations_updated_at" BEFORE UPDATE ON "public"."zotero_integrations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extraction_consensus_decisions_updated_at" BEFORE UPDATE ON "public"."extraction_consensus_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extraction_hitl_configs_updated_at" BEFORE UPDATE ON "public"."extraction_hitl_configs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extraction_proposal_records_updated_at" BEFORE UPDATE ON "public"."extraction_proposal_records" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extraction_published_states_updated_at" BEFORE UPDATE ON "public"."extraction_published_states" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extraction_reviewer_decisions_updated_at" BEFORE UPDATE ON "public"."extraction_reviewer_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extraction_reviewer_states_updated_at" BEFORE UPDATE ON "public"."extraction_reviewer_states" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_extraction_template_versions_updated_at" BEFORE UPDATE ON "public"."extraction_template_versions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."article_annotations"
    ADD CONSTRAINT "article_annotations_article_file_id_fkey" FOREIGN KEY ("article_file_id") REFERENCES "public"."article_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."article_annotations"
    ADD CONSTRAINT "article_annotations_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_annotations"
    ADD CONSTRAINT "article_annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."article_author_links"
    ADD CONSTRAINT "article_author_links_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_author_links"
    ADD CONSTRAINT "article_author_links_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."article_authors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."article_boxes"
    ADD CONSTRAINT "article_boxes_article_file_id_fkey" FOREIGN KEY ("article_file_id") REFERENCES "public"."article_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."article_boxes"
    ADD CONSTRAINT "article_boxes_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_boxes"
    ADD CONSTRAINT "article_boxes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."article_files"
    ADD CONSTRAINT "article_files_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_files"
    ADD CONSTRAINT "article_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_highlights"
    ADD CONSTRAINT "article_highlights_article_file_id_fkey" FOREIGN KEY ("article_file_id") REFERENCES "public"."article_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."article_highlights"
    ADD CONSTRAINT "article_highlights_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_highlights"
    ADD CONSTRAINT "article_highlights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."article_sync_events"
    ADD CONSTRAINT "article_sync_events_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."article_sync_events"
    ADD CONSTRAINT "article_sync_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_sync_events"
    ADD CONSTRAINT "article_sync_events_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "public"."article_sync_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_sync_runs"
    ADD CONSTRAINT "article_sync_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extracted_values"
    ADD CONSTRAINT "extracted_values_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extracted_values"
    ADD CONSTRAINT "extracted_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."extraction_fields"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extracted_values"
    ADD CONSTRAINT "extracted_values_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extracted_values"
    ADD CONSTRAINT "extracted_values_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extracted_values"
    ADD CONSTRAINT "extracted_values_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_consensus_decisions"
    ADD CONSTRAINT "extraction_consensus_decisions_consensus_user_id_fkey" FOREIGN KEY ("consensus_user_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_consensus_decisions"
    ADD CONSTRAINT "extraction_consensus_decisions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."extraction_fields"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_consensus_decisions"
    ADD CONSTRAINT "extraction_consensus_decisions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_consensus_decisions"
    ADD CONSTRAINT "extraction_consensus_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_consensus_decisions"
    ADD CONSTRAINT "extraction_consensus_decisions_selected_decision_id_fkey" FOREIGN KEY ("selected_decision_id") REFERENCES "public"."extraction_reviewer_decisions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_entity_types"
    ADD CONSTRAINT "extraction_entity_types_parent_entity_type_id_fkey" FOREIGN KEY ("parent_entity_type_id") REFERENCES "public"."extraction_entity_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_entity_types"
    ADD CONSTRAINT "extraction_entity_types_project_template_id_fkey" FOREIGN KEY ("project_template_id") REFERENCES "public"."project_extraction_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_entity_types"
    ADD CONSTRAINT "extraction_entity_types_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."extraction_templates_global"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_article_file_id_fkey" FOREIGN KEY ("article_file_id") REFERENCES "public"."article_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_consensus_decision_id_fkey" FOREIGN KEY ("consensus_decision_id") REFERENCES "public"."extraction_consensus_decisions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_proposal_record_id_fkey" FOREIGN KEY ("proposal_record_id") REFERENCES "public"."extraction_proposal_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_reviewer_decision_id_fkey" FOREIGN KEY ("reviewer_decision_id") REFERENCES "public"."extraction_reviewer_decisions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_evidence"
    ADD CONSTRAINT "extraction_evidence_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_fields"
    ADD CONSTRAINT "extraction_fields_entity_type_id_fkey" FOREIGN KEY ("entity_type_id") REFERENCES "public"."extraction_entity_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_hitl_configs"
    ADD CONSTRAINT "extraction_hitl_configs_arbitrator_id_fkey" FOREIGN KEY ("arbitrator_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_instances"
    ADD CONSTRAINT "extraction_instances_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_instances"
    ADD CONSTRAINT "extraction_instances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_instances"
    ADD CONSTRAINT "extraction_instances_entity_type_id_fkey" FOREIGN KEY ("entity_type_id") REFERENCES "public"."extraction_entity_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_instances"
    ADD CONSTRAINT "extraction_instances_parent_instance_id_fkey" FOREIGN KEY ("parent_instance_id") REFERENCES "public"."extraction_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_instances"
    ADD CONSTRAINT "extraction_instances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_instances"
    ADD CONSTRAINT "extraction_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_extraction_templates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_proposal_records"
    ADD CONSTRAINT "extraction_proposal_records_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."extraction_fields"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_proposal_records"
    ADD CONSTRAINT "extraction_proposal_records_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_proposal_records"
    ADD CONSTRAINT "extraction_proposal_records_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_proposal_records"
    ADD CONSTRAINT "extraction_proposal_records_source_user_id_fkey" FOREIGN KEY ("source_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_published_states"
    ADD CONSTRAINT "extraction_published_states_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."extraction_fields"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_published_states"
    ADD CONSTRAINT "extraction_published_states_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_published_states"
    ADD CONSTRAINT "extraction_published_states_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_published_states"
    ADD CONSTRAINT "extraction_published_states_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_reviewer_decisions"
    ADD CONSTRAINT "extraction_reviewer_decisions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."extraction_fields"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_reviewer_decisions"
    ADD CONSTRAINT "extraction_reviewer_decisions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_reviewer_decisions"
    ADD CONSTRAINT "extraction_reviewer_decisions_proposal_record_id_fkey" FOREIGN KEY ("proposal_record_id") REFERENCES "public"."extraction_proposal_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_reviewer_decisions"
    ADD CONSTRAINT "extraction_reviewer_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_reviewer_decisions"
    ADD CONSTRAINT "extraction_reviewer_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_reviewer_states"
    ADD CONSTRAINT "extraction_reviewer_states_current_decision_id_fkey" FOREIGN KEY ("current_decision_id") REFERENCES "public"."extraction_reviewer_decisions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_reviewer_states"
    ADD CONSTRAINT "extraction_reviewer_states_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."extraction_fields"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_reviewer_states"
    ADD CONSTRAINT "extraction_reviewer_states_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "public"."extraction_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_reviewer_states"
    ADD CONSTRAINT "extraction_reviewer_states_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_reviewer_states"
    ADD CONSTRAINT "extraction_reviewer_states_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "extraction_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_extraction_templates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."extraction_template_versions"
    ADD CONSTRAINT "extraction_template_versions_project_template_id_fkey" FOREIGN KEY ("project_template_id") REFERENCES "public"."project_extraction_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_template_versions"
    ADD CONSTRAINT "extraction_template_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."feedback_reports"
    ADD CONSTRAINT "feedback_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "fk_extraction_runs_template_kind_coherence" FOREIGN KEY ("template_id", "kind") REFERENCES "public"."project_extraction_templates"("id", "kind") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."extraction_runs"
    ADD CONSTRAINT "fk_extraction_runs_version_id" FOREIGN KEY ("version_id") REFERENCES "public"."extraction_template_versions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_extraction_templates"
    ADD CONSTRAINT "project_extraction_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_extraction_templates"
    ADD CONSTRAINT "project_extraction_templates_global_template_id_fkey" FOREIGN KEY ("global_template_id") REFERENCES "public"."extraction_templates_global"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_extraction_templates"
    ADD CONSTRAINT "project_extraction_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zotero_integrations"
    ADD CONSTRAINT "zotero_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."article_annotations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_annotations_delete" ON "public"."article_annotations" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_annotations"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_annotations_insert" ON "public"."article_annotations" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_annotations"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_annotations_select" ON "public"."article_annotations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_annotations"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_annotations_update" ON "public"."article_annotations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_annotations"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."article_author_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_author_links_delete" ON "public"."article_author_links" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."articles" "a"
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "a"."project_id")))
  WHERE (("a"."id" = "article_author_links"."article_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_author_links_insert" ON "public"."article_author_links" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."articles" "a"
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "a"."project_id")))
  WHERE (("a"."id" = "article_author_links"."article_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_author_links_select" ON "public"."article_author_links" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."articles" "a"
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "a"."project_id")))
  WHERE (("a"."id" = "article_author_links"."article_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_author_links_update" ON "public"."article_author_links" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."articles" "a"
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "a"."project_id")))
  WHERE (("a"."id" = "article_author_links"."article_id") AND ("pm"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."articles" "a"
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "a"."project_id")))
  WHERE (("a"."id" = "article_author_links"."article_id") AND ("pm"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."article_authors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_authors_manage" ON "public"."article_authors" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "article_authors_select" ON "public"."article_authors" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (("public"."article_author_links" "aal"
     JOIN "public"."articles" "a" ON (("a"."id" = "aal"."article_id")))
     JOIN "public"."project_members" "pm" ON (("pm"."project_id" = "a"."project_id")))
  WHERE (("aal"."author_id" = "article_authors"."id") AND ("pm"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."article_boxes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_boxes_delete" ON "public"."article_boxes" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_boxes"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_boxes_insert" ON "public"."article_boxes" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_boxes"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_boxes_select" ON "public"."article_boxes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_boxes"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_boxes_update" ON "public"."article_boxes" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_boxes"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."article_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_files_delete" ON "public"."article_files" FOR DELETE USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "article_files_insert" ON "public"."article_files" FOR INSERT WITH CHECK ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "article_files_select" ON "public"."article_files" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "article_files_update" ON "public"."article_files" FOR UPDATE USING ("public"."is_project_member"("project_id", "auth"."uid"()));



ALTER TABLE "public"."article_highlights" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_highlights_delete" ON "public"."article_highlights" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_highlights"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_highlights_insert" ON "public"."article_highlights" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_highlights"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_highlights_select" ON "public"."article_highlights" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_highlights"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



CREATE POLICY "article_highlights_update" ON "public"."article_highlights" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."articles"
  WHERE (("articles"."id" = "article_highlights"."article_id") AND "public"."is_project_member"("articles"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."article_sync_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_sync_events_delete" ON "public"."article_sync_events" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_events"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_sync_events_insert" ON "public"."article_sync_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_events"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_sync_events_select" ON "public"."article_sync_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_events"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_sync_events_update" ON "public"."article_sync_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_events"."project_id") AND ("pm"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_events"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."article_sync_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "article_sync_runs_delete" ON "public"."article_sync_runs" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_runs"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_sync_runs_insert" ON "public"."article_sync_runs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_runs"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_sync_runs_select" ON "public"."article_sync_runs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_runs"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



CREATE POLICY "article_sync_runs_update" ON "public"."article_sync_runs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_runs"."project_id") AND ("pm"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "article_sync_runs"."project_id") AND ("pm"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."articles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "articles_delete" ON "public"."articles" FOR DELETE USING ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "articles_insert" ON "public"."articles" FOR INSERT WITH CHECK ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "articles_select" ON "public"."articles" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "articles_update" ON "public"."articles" FOR UPDATE USING ("public"."is_project_member"("project_id", "auth"."uid"())) WITH CHECK ("public"."is_project_member"("project_id", "auth"."uid"()));



ALTER TABLE "public"."extracted_values" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extracted_values_delete" ON "public"."extracted_values" FOR DELETE USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extracted_values_insert" ON "public"."extracted_values" FOR INSERT WITH CHECK ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extracted_values_select" ON "public"."extracted_values" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extracted_values_update" ON "public"."extracted_values" FOR UPDATE USING ("public"."is_project_member"("project_id", "auth"."uid"()));



ALTER TABLE "public"."extraction_consensus_decisions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_consensus_decisions_delete" ON "public"."extraction_consensus_decisions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_consensus_decisions"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_consensus_decisions_insert" ON "public"."extraction_consensus_decisions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_consensus_decisions"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_consensus_decisions_select" ON "public"."extraction_consensus_decisions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_consensus_decisions"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_consensus_decisions_update" ON "public"."extraction_consensus_decisions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_consensus_decisions"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_consensus_decisions"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."extraction_entity_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_entity_types_project_delete" ON "public"."extraction_entity_types" FOR DELETE USING ((("project_template_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "pet"
  WHERE (("pet"."id" = "extraction_entity_types"."project_template_id") AND "public"."is_project_manager"("pet"."project_id", "auth"."uid"()))))));



CREATE POLICY "extraction_entity_types_project_insert" ON "public"."extraction_entity_types" FOR INSERT WITH CHECK ((("project_template_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "pet"
  WHERE (("pet"."id" = "extraction_entity_types"."project_template_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"()))))));



CREATE POLICY "extraction_entity_types_project_update" ON "public"."extraction_entity_types" FOR UPDATE USING ((("project_template_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "pet"
  WHERE (("pet"."id" = "extraction_entity_types"."project_template_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"()))))));



CREATE POLICY "extraction_entity_types_select" ON "public"."extraction_entity_types" FOR SELECT USING (true);



ALTER TABLE "public"."extraction_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_evidence_delete" ON "public"."extraction_evidence" FOR DELETE USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extraction_evidence_insert" ON "public"."extraction_evidence" FOR INSERT WITH CHECK ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extraction_evidence_select" ON "public"."extraction_evidence" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



ALTER TABLE "public"."extraction_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_fields_project_delete" ON "public"."extraction_fields" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_entity_types" "et"
     JOIN "public"."project_extraction_templates" "pet" ON (("pet"."id" = "et"."project_template_id")))
  WHERE (("et"."id" = "extraction_fields"."entity_type_id") AND "public"."is_project_manager"("pet"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_fields_project_insert" ON "public"."extraction_fields" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_entity_types" "et"
     JOIN "public"."project_extraction_templates" "pet" ON (("pet"."id" = "et"."project_template_id")))
  WHERE (("et"."id" = "extraction_fields"."entity_type_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_fields_project_update" ON "public"."extraction_fields" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_entity_types" "et"
     JOIN "public"."project_extraction_templates" "pet" ON (("pet"."id" = "et"."project_template_id")))
  WHERE (("et"."id" = "extraction_fields"."entity_type_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_fields_select" ON "public"."extraction_fields" FOR SELECT USING (true);



ALTER TABLE "public"."extraction_hitl_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_hitl_configs_delete" ON "public"."extraction_hitl_configs" FOR DELETE USING (((("scope_kind" = 'project'::"public"."hitl_config_scope_kind") AND "public"."is_project_manager"("scope_id", "auth"."uid"())) OR (("scope_kind" = 'template'::"public"."hitl_config_scope_kind") AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_hitl_configs"."scope_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"())))))));



CREATE POLICY "extraction_hitl_configs_insert" ON "public"."extraction_hitl_configs" FOR INSERT WITH CHECK (((("scope_kind" = 'project'::"public"."hitl_config_scope_kind") AND "public"."is_project_manager"("scope_id", "auth"."uid"())) OR (("scope_kind" = 'template'::"public"."hitl_config_scope_kind") AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_hitl_configs"."scope_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"())))))));



CREATE POLICY "extraction_hitl_configs_select" ON "public"."extraction_hitl_configs" FOR SELECT USING (((("scope_kind" = 'project'::"public"."hitl_config_scope_kind") AND "public"."is_project_member"("scope_id", "auth"."uid"())) OR (("scope_kind" = 'template'::"public"."hitl_config_scope_kind") AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_hitl_configs"."scope_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))))));



CREATE POLICY "extraction_hitl_configs_update" ON "public"."extraction_hitl_configs" FOR UPDATE USING (((("scope_kind" = 'project'::"public"."hitl_config_scope_kind") AND "public"."is_project_manager"("scope_id", "auth"."uid"())) OR (("scope_kind" = 'template'::"public"."hitl_config_scope_kind") AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_hitl_configs"."scope_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"()))))))) WITH CHECK (((("scope_kind" = 'project'::"public"."hitl_config_scope_kind") AND "public"."is_project_manager"("scope_id", "auth"."uid"())) OR (("scope_kind" = 'template'::"public"."hitl_config_scope_kind") AND (EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_hitl_configs"."scope_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"())))))));



ALTER TABLE "public"."extraction_instances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_instances_delete" ON "public"."extraction_instances" FOR DELETE USING ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "extraction_instances_insert" ON "public"."extraction_instances" FOR INSERT WITH CHECK ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extraction_instances_select" ON "public"."extraction_instances" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extraction_instances_update" ON "public"."extraction_instances" FOR UPDATE USING ("public"."is_project_member"("project_id", "auth"."uid"()));



ALTER TABLE "public"."extraction_proposal_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_proposal_records_delete" ON "public"."extraction_proposal_records" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_proposal_records"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_proposal_records_insert" ON "public"."extraction_proposal_records" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_proposal_records"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_proposal_records_select" ON "public"."extraction_proposal_records" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_proposal_records"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_proposal_records_update" ON "public"."extraction_proposal_records" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_proposal_records"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_proposal_records"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."extraction_published_states" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_published_states_delete" ON "public"."extraction_published_states" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_published_states"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_published_states_insert" ON "public"."extraction_published_states" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_published_states"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_published_states_select" ON "public"."extraction_published_states" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_published_states"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_published_states_update" ON "public"."extraction_published_states" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_published_states"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_published_states"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."extraction_reviewer_decisions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_reviewer_decisions_delete" ON "public"."extraction_reviewer_decisions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_decisions"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_reviewer_decisions_insert" ON "public"."extraction_reviewer_decisions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_decisions"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_reviewer_decisions_select" ON "public"."extraction_reviewer_decisions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_decisions"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_reviewer_decisions_update" ON "public"."extraction_reviewer_decisions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_decisions"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_decisions"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."extraction_reviewer_states" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_reviewer_states_delete" ON "public"."extraction_reviewer_states" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_states"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_reviewer_states_insert" ON "public"."extraction_reviewer_states" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_states"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_reviewer_states_select" ON "public"."extraction_reviewer_states" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_states"."run_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_reviewer_states_update" ON "public"."extraction_reviewer_states" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_states"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."extraction_runs" "r"
     JOIN "public"."project_extraction_templates" "t" ON (("t"."id" = "r"."template_id")))
  WHERE (("r"."id" = "extraction_reviewer_states"."run_id") AND "public"."is_project_reviewer"("t"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."extraction_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_runs_insert" ON "public"."extraction_runs" FOR INSERT WITH CHECK ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extraction_runs_select" ON "public"."extraction_runs" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "extraction_runs_update" ON "public"."extraction_runs" FOR UPDATE USING ("public"."is_project_member"("project_id", "auth"."uid"()));



ALTER TABLE "public"."extraction_template_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_template_versions_delete" ON "public"."extraction_template_versions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_template_versions"."project_template_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_template_versions_insert" ON "public"."extraction_template_versions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_template_versions"."project_template_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_template_versions_select" ON "public"."extraction_template_versions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_template_versions"."project_template_id") AND "public"."is_project_member"("t"."project_id", "auth"."uid"())))));



CREATE POLICY "extraction_template_versions_update" ON "public"."extraction_template_versions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_template_versions"."project_template_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."project_extraction_templates" "t"
  WHERE (("t"."id" = "extraction_template_versions"."project_template_id") AND "public"."is_project_manager"("t"."project_id", "auth"."uid"())))));



ALTER TABLE "public"."extraction_templates_global" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extraction_templates_global_insert" ON "public"."extraction_templates_global" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "extraction_templates_global_select" ON "public"."extraction_templates_global" FOR SELECT USING (true);



CREATE POLICY "extraction_templates_global_update" ON "public"."extraction_templates_global" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."feedback_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_reports_insert" ON "public"."feedback_reports" FOR INSERT WITH CHECK (true);



CREATE POLICY "feedback_reports_select_own" ON "public"."feedback_reports" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_delete" ON "public"."projects" FOR DELETE USING ("public"."is_project_manager"("id", "auth"."uid"()));



ALTER TABLE "public"."project_extraction_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_extraction_templates_delete" ON "public"."project_extraction_templates" FOR DELETE USING ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "project_extraction_templates_insert" ON "public"."project_extraction_templates" FOR INSERT WITH CHECK ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "project_extraction_templates_select" ON "public"."project_extraction_templates" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "project_extraction_templates_update" ON "public"."project_extraction_templates" FOR UPDATE USING ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "project_insert" ON "public"."projects" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by_id"));



ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_members_delete" ON "public"."project_members" FOR DELETE USING ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "project_members_insert" ON "public"."project_members" FOR INSERT WITH CHECK ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "project_members_select" ON "public"."project_members" FOR SELECT USING ("public"."is_project_member"("project_id", "auth"."uid"()));



CREATE POLICY "project_members_update" ON "public"."project_members" FOR UPDATE USING ("public"."is_project_manager"("project_id", "auth"."uid"()));



CREATE POLICY "project_select" ON "public"."projects" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "projects"."id") AND ("project_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "project_update" ON "public"."projects" FOR UPDATE USING ("public"."is_project_manager"("id", "auth"."uid"()));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_api_keys_delete" ON "public"."user_api_keys" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_api_keys_insert" ON "public"."user_api_keys" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_api_keys_select" ON "public"."user_api_keys" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_api_keys_update" ON "public"."user_api_keys" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."zotero_integrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "zotero_integrations_delete" ON "public"."zotero_integrations" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "zotero_integrations_insert" ON "public"."zotero_integrations" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "zotero_integrations_select" ON "public"."zotero_integrations" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "zotero_integrations_update" ON "public"."zotero_integrations" FOR UPDATE USING (("user_id" = "auth"."uid"()));



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT ALL ON SCHEMA "public" TO PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_model_progress"("p_project_id" "uuid", "p_article_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_model_progress"("p_project_id" "uuid", "p_article_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_cardinality_one"("p_article_id" "uuid", "p_entity_type_id" "uuid", "p_parent_instance_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_cardinality_one"("p_article_id" "uuid", "p_entity_type_id" "uuid", "p_parent_instance_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_project_with_member"("p_name" "text", "p_description" "text", "p_review_type" "public"."review_type", "p_created_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_project_with_member"("p_name" "text", "p_description" "text", "p_review_type" "public"."review_type", "p_created_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_consensus_override_justification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_consensus_override_justification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_extraction_instance_cardinality"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_extraction_instance_cardinality"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_default_api_key"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_default_api_key"() TO "service_role";



GRANT ALL ON FUNCTION "public"."find_user_id_by_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_user_id_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_project_members"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_project_members"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_manager"("p_project_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_manager"("p_project_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("p_project_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_project_reviewer"("p_project_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_reviewer"("p_project_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_extraction_instance_hierarchy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_extraction_instance_hierarchy"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_instance_project_consistency"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_instance_project_consistency"() TO "service_role";






GRANT ALL ON TABLE "public"."article_annotations" TO "authenticated";
GRANT ALL ON TABLE "public"."article_annotations" TO "service_role";



GRANT ALL ON TABLE "public"."article_author_links" TO "authenticated";
GRANT ALL ON TABLE "public"."article_author_links" TO "service_role";



GRANT ALL ON TABLE "public"."article_authors" TO "authenticated";
GRANT ALL ON TABLE "public"."article_authors" TO "service_role";



GRANT ALL ON TABLE "public"."article_boxes" TO "authenticated";
GRANT ALL ON TABLE "public"."article_boxes" TO "service_role";



GRANT ALL ON TABLE "public"."article_files" TO "authenticated";
GRANT ALL ON TABLE "public"."article_files" TO "service_role";



GRANT ALL ON TABLE "public"."article_highlights" TO "authenticated";
GRANT ALL ON TABLE "public"."article_highlights" TO "service_role";



GRANT ALL ON TABLE "public"."article_sync_events" TO "authenticated";
GRANT ALL ON TABLE "public"."article_sync_events" TO "service_role";



GRANT ALL ON TABLE "public"."article_sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."article_sync_runs" TO "service_role";



GRANT ALL ON TABLE "public"."articles" TO "authenticated";
GRANT ALL ON TABLE "public"."articles" TO "service_role";



GRANT ALL ON TABLE "public"."extracted_values" TO "authenticated";
GRANT ALL ON TABLE "public"."extracted_values" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_consensus_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_consensus_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_entity_types" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_entity_types" TO "service_role";
GRANT SELECT ON TABLE "public"."extraction_entity_types" TO "anon";



GRANT ALL ON TABLE "public"."extraction_evidence" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_fields" TO "service_role";
GRANT SELECT ON TABLE "public"."extraction_fields" TO "anon";



GRANT ALL ON TABLE "public"."extraction_hitl_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_hitl_configs" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_instances" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_proposal_records" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_proposal_records" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_published_states" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_published_states" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_reviewer_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_reviewer_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_reviewer_states" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_reviewer_states" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_runs" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_template_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_template_versions" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_templates_global" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_templates_global" TO "service_role";
GRANT SELECT ON TABLE "public"."extraction_templates_global" TO "anon";



GRANT ALL ON TABLE "public"."feedback_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback_reports" TO "service_role";



GRANT ALL ON TABLE "public"."migration_status" TO "authenticated";
GRANT ALL ON TABLE "public"."migration_status" TO "service_role";



GRANT ALL ON SEQUENCE "public"."migration_status_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."migration_status_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_extraction_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_extraction_templates" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."user_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."user_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."zotero_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."zotero_integrations" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




