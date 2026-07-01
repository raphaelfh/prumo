---
status: draft
last_reviewed: 2026-07-01
owner: '@raphaelfh'
---

# Supabase advisor backlog — remediation triage

> **Scope split.** This doc is the *separate tracked effort* to burn down
> the 199-item Supabase advisor backlog. The PR that created it only
> **ratchets the `/preflight` gate** (a checked-in baseline so new advisors
> fail while the known backlog does not) — it fixes **none** of the items
> below. Work them in their own PRs, each verified independently.

**Baseline snapshot:** 2026-07-01, 199 advisors — 15 security, 184
performance. The canonical fingerprint list is checked in at
[`.claude/skills/preflight/supabase-advisors.baseline`](../../../.claude/skills/preflight/supabase-advisors.baseline).
Regenerate after any remediation with `/preflight --update-advisors-baseline`
so the gate tightens as items are fixed.

## Golden rules for this effort

- **`public.*` DDL goes through Alembic**, never the Supabase MCP
  `apply_migration` (that pollutes `schema_migrations` and leaves
  `alembic_version` stale — see the migrations reference). RLS policies,
  indexes, and functions on the app schema are all Alembic migrations run
  from `backend/` (`alembic revision --autogenerate -m "..."` or a hand-
  written revision for policy/DDL that autogenerate can't see).
- **`auth`/`storage` changes go through the Supabase CLI** (`supabase db
  push`), not Alembic. None of the items below live in those schemas, so
  every migration here is Alembic.
- **Each migration must round-trip.** Review `alembic upgrade --sql` and
  `alembic downgrade --sql` for the revision, both directions, before
  applying. Revision ids ≤ 32 chars (`alembic_version.version_num` is
  `varchar(32)`).
- **Never touch prod data.** These are schema/policy/index/settings
  changes only.
- Re-run `get_advisors` (or `/preflight --remote-only`) after each PR to
  confirm the targeted advisors cleared and none regressed.

---

## Bucket 1 — Mechanical, safe, reversible (Alembic on `public.*`)

### 1A. `auth_rls_initplan` — 110 policies across 30 tables (performance, WARN)

Each flagged policy calls `auth.uid()` / `auth.role()` /
`current_setting()` **directly**, so Postgres re-evaluates it **per row**.
Wrapping the call in a scalar subquery — `(select auth.uid())` — makes the
planner evaluate it **once per query** (an initplan). Semantics are
identical; this is a pure performance fix.

- **Approach:** for every policy, rewrite `USING` / `WITH CHECK` predicates
  so each `auth.<fn>()` / `current_setting(...)` becomes `(select
  auth.<fn>())` / `(select current_setting(...))`. Prefer regenerating the
  policies from the canonical policy definitions (the RLS policies live in
  Alembic revisions already) rather than editing 110 in place.
- **Reversible:** yes — the inverse rewrite restores the original text.
- **Suggested batching:** one migration per functional cluster to keep
  diffs reviewable, e.g. `articles*` (annotations, author_links, authors,
  boxes, files, highlights, sync_events, sync_runs, text_blocks, articles),
  `extraction_*`, and `misc` (profiles, project_members, projects,
  project_extraction_templates, user_api_keys, zotero_integrations).

Affected tables (policy counts): article_annotations (4),
article_author_links (4), article_authors (3), article_boxes (4),
article_files (4), article_highlights (4), article_sync_events (4),
article_sync_runs (4), article_text_blocks (4), articles (4),
extraction_consensus_decisions (4), extraction_entity_types (3),
extraction_evidence (3), extraction_fields (3), extraction_hitl_configs
(4), extraction_instances (4), extraction_proposal_records (4),
extraction_published_states (4), extraction_reviewer_decisions (4),
extraction_reviewer_ready (3), extraction_reviewer_states (4),
extraction_runs (3), extraction_template_versions (4),
extraction_templates_global (2), profiles (2),
project_extraction_templates (4), project_members (4), projects (4),
user_api_keys (4), zotero_integrations (4).

> The full per-policy list is recoverable from `get_advisors` (name
> `auth_rls_initplan`) or the baseline file; it is not duplicated here to
> avoid drift.

### 1B. `unindexed_foreign_keys` — 45 FKs (performance, INFO)

Add a covering index on the referencing column(s) of each FK (a plain
btree on the FK column, matching `fkey_columns`). Improves join and
cascade-delete performance. Reversible via `DROP INDEX`.

```
public.article_annotations              article_annotations_article_file_id_fkey
public.article_annotations              article_annotations_article_id_fkey
public.article_annotations              article_annotations_user_id_fkey
public.article_boxes                    article_boxes_article_file_id_fkey
public.article_boxes                    article_boxes_article_id_fkey
public.article_boxes                    article_boxes_user_id_fkey
public.article_highlights               article_highlights_article_file_id_fkey
public.article_highlights               article_highlights_article_id_fkey
public.article_highlights               article_highlights_user_id_fkey
public.article_sync_events              article_sync_events_article_id_fkey
public.extraction_consensus_decisions   extraction_consensus_decisions_consensus_user_id_fkey
public.extraction_consensus_decisions   extraction_consensus_decisions_field_id_fkey
public.extraction_consensus_decisions   extraction_consensus_decisions_instance_id_fkey
public.extraction_consensus_decisions   fk_extraction_consensus_decisions_selected_run_match
public.extraction_evidence              extraction_evidence_article_file_id_fkey
public.extraction_evidence              extraction_evidence_consensus_decision_id_fkey
public.extraction_evidence              extraction_evidence_created_by_fkey
public.extraction_evidence              extraction_evidence_proposal_record_id_fkey
public.extraction_evidence              extraction_evidence_reviewer_decision_id_fkey
public.extraction_hitl_configs          extraction_hitl_configs_arbitrator_id_fkey
public.extraction_instances             extraction_instances_created_by_fkey
public.extraction_proposal_records      extraction_proposal_records_field_id_fkey
public.extraction_proposal_records      extraction_proposal_records_source_user_id_fkey
public.extraction_published_states      extraction_published_states_field_id_fkey
public.extraction_published_states      extraction_published_states_instance_id_fkey
public.extraction_published_states      extraction_published_states_published_by_fkey
public.extraction_reviewer_decisions    extraction_reviewer_decisions_field_id_fkey
public.extraction_reviewer_decisions    extraction_reviewer_decisions_instance_id_fkey
public.extraction_reviewer_decisions    extraction_reviewer_decisions_proposal_record_id_fkey
public.extraction_reviewer_decisions    extraction_reviewer_decisions_reviewer_id_fkey
public.extraction_reviewer_ready        extraction_reviewer_ready_reviewer_id_fkey
public.extraction_reviewer_states       extraction_reviewer_states_field_id_fkey
public.extraction_reviewer_states       extraction_reviewer_states_instance_id_fkey
public.extraction_reviewer_states       extraction_reviewer_states_reviewer_id_fkey
public.extraction_reviewer_states       fk_extraction_reviewer_states_decision_run_match
public.extraction_runs                  extraction_runs_created_by_fkey
public.extraction_runs                  fk_extraction_runs_template_kind_coherence
public.extraction_runs                  fk_extraction_runs_version_id
public.extraction_template_versions     extraction_template_versions_published_by_fkey
public.feedback_reports                 feedback_reports_article_id_fkey
public.feedback_reports                 feedback_reports_project_id_fkey
public.feedback_reports                 feedback_reports_user_id_fkey
public.project_extraction_templates     project_extraction_templates_created_by_fkey
public.project_extraction_templates     project_extraction_templates_global_template_id_fkey
public.project_members                  project_members_created_by_id_fkey
```

### 1C. `unused_index` — 29 indexes (performance, INFO) — **confirm before dropping**

Advisor reports zero scans in `pg_stat_user_indexes`. **Do not bulk-drop.**
Zero scans often means "the feature that needs this index has not been
exercised in prod yet," not "the index is dead." Several here are GIN
indexes backing JSONB search/filter (`*_gin`) and article-lookup indexes
(`doi`, `pmid`, `mesh`, `keywords`, `trgm_title`) — dropping one silently
regresses that feature the first time a user hits it. Per index: confirm
`idx_scan = 0` **and** that no code path/roadmap feature depends on it,
then drop (reversible via `CREATE INDEX`).

```
idx_article_author_links_author_id            public.article_author_links
idx_article_sync_events_status                public.article_sync_events
idx_article_sync_events_sync_run_id           public.article_sync_events
idx_article_sync_runs_requested_by_user_id    public.article_sync_runs
idx_article_sync_runs_status                  public.article_sync_runs
idx_articles_biblio                           public.articles
idx_articles_doi                              public.articles
idx_articles_keywords                         public.articles
idx_articles_last_synced_at                   public.articles
idx_articles_mesh                             public.articles
idx_articles_pmid                             public.articles
idx_articles_source_payload_gin               public.articles
idx_articles_sync_state                       public.articles
idx_articles_trgm_title                       public.articles   # depends on pg_trgm — see 3B
idx_extraction_consensus_decisions_run_id     public.extraction_consensus_decisions
idx_extraction_evidence_position_gin          public.extraction_evidence
idx_extraction_instances_metadata_gin         public.extraction_instances
idx_extraction_runs_kind                      public.extraction_runs
idx_extraction_runs_parameters_gin            public.extraction_runs
idx_extraction_runs_results_gin               public.extraction_runs
idx_extraction_runs_status_stage              public.extraction_runs
idx_extraction_templates_global_schema_gin    public.extraction_templates_global
idx_project_extraction_templates_project_id   public.project_extraction_templates
idx_project_extraction_templates_schema_gin   public.project_extraction_templates
idx_projects_created_by_id                    public.projects
idx_projects_eligibility_criteria_gin         public.projects
idx_projects_review_keywords_gin              public.projects
idx_projects_settings_gin                     public.projects
idx_projects_study_design_gin                 public.projects
```

> Note: `idx_project_extraction_templates_project_id` covers the FK
> `project_extraction_templates_*` — reconcile 1B and 1C so a FK's covering
> index is not both "added" and "dropped."

### 1D. `function_search_path_mutable` — 1 function (security, WARN)

`public.check_model_section_parent_role` has a mutable `search_path`. Pin
it and schema-qualify every object reference in the body:

```sql
ALTER FUNCTION public.check_model_section_parent_role() SET search_path = '';
```

Reversible via `RESET`/re-set. Verify the body still resolves all objects
with explicit `public.`/`pg_catalog.` qualification after pinning.

### 1E. `rls_enabled_no_policy` — 3 tables (security, INFO)

| Table | Disposition |
|-------|-------------|
| `public.feedback_attachments` | Add correct RLS policies (owner/project scoped, matching `feedback_reports`). |
| `public.feedback_reports` | Add correct RLS policies (this table also appears in 1B with unindexed FKs). |
| `public.alembic_version` | **Not** a user table — Alembic's bookkeeping. Confirm it is reachable only by the migration (service) role and **document** that RLS-with-no-policy is intentional (deny-all to `anon`/`authenticated`), rather than inventing a policy. |

---

## Bucket 2 — Settings toggle (Supabase dashboard, human)

### 2A. `auth_leaked_password_protection` (security, WARN)

Enable **Leaked Password Protection** (HaveIBeenPwned check) in the
Supabase dashboard → Authentication → Policies/Password. Dashboard toggle,
not a migration. No code change; verify the advisor clears afterward.

---

## Bucket 3 — Needs a human decision (do NOT auto-change)

### 3A. `authenticated_security_definer_function_executable` — 9 functions (security, WARN)

Each is a `SECURITY DEFINER` RPC callable by the `authenticated` role via
`/rest/v1/rpc/<fn>`. Decide **per function** whether signed-in users should
be able to call it directly. If not: `REVOKE EXECUTE ... FROM authenticated`
(and/or `SECURITY INVOKER`) via an Alembic migration; if yes, document the
intent. Most look like internal authorization/predicate helpers that the
**backend** calls, not something the client should invoke over PostgREST —
but confirm each against actual call sites before revoking.

| Function (signature) | Apparent purpose | Likely disposition (confirm) |
|----------------------|------------------|------------------------------|
| `calculate_model_progress(p_article_id uuid, p_model_id uuid)` | Compute extraction completion % | Internal — likely revoke client EXECUTE |
| `check_cardinality_one(p_article_id uuid, p_entity_type_id uuid, p_parent_instance_id uuid)` | Cardinality constraint helper | Internal — likely revoke |
| `create_project_with_member(p_name text, p_description text, p_review_type public.review_type, p_created_by uuid)` | Transactional project+owner creation | **Check:** if the app calls this RPC from the client it must stay EXECUTE-able; else revoke |
| `find_user_id_by_email(p_email text, p_project_id uuid)` | Email→user lookup for invites | **Sensitive** (enumeration) — review scoping; likely revoke direct client access |
| `get_project_members(p_project_id uuid)` | List members | Likely used by client — confirm before revoking |
| `is_project_arbitrator(p_project_id uuid, p_user_id uuid)` | Role predicate | Internal predicate — likely revoke |
| `is_project_manager(p_project_id uuid, p_user_id uuid)` | Role predicate | Internal predicate — likely revoke |
| `is_project_member(p_project_id uuid, p_user_id uuid)` | Role predicate (used by RLS) | Internal predicate — likely revoke |
| `is_project_reviewer(p_project_id uuid, p_user_id uuid)` | Role predicate | Internal predicate — likely revoke |

> The `is_project_*` predicates are almost certainly invoked from RLS
> policies (definer context), which is unaffected by revoking the
> `authenticated` role's direct `EXECUTE`. Verify with a grep of the
> frontend/services for `rpc(` before changing.

### 3B. `extension_in_public` — `pg_trgm` (security, WARN)

`pg_trgm` sits in `public`. Best practice is a dedicated `extensions`
schema:

```sql
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
```

**Do this only after** confirming nothing references pg_trgm functions
(`similarity`, `word_similarity`, the `%`/`<->` operators) or opclasses
unqualified as `public.<fn>`. Note `idx_articles_trgm_title` (1C) uses a
pg_trgm opclass — moving the extension can require the index's opclass
reference and any query's `search_path` to be updated. Treat as a
coordinated change (extension move + search_path/qualification audit + the
trgm index), not a one-liner. Human sign-off required.

---

## Suggested sequencing

1. **1B + 1D + 1E** (add FK indexes, pin the one function, add the two
   feedback policies + document `alembic_version`) — lowest risk, clears
   ~49 advisors.
2. **1A** in reviewable batches — clears 110, pure perf, no behavior change.
3. **1C** after a usage audit — clears up to 29, but each drop is a
   judgment call.
4. **2A** — one dashboard toggle.
5. **3A / 3B** — after human decisions and call-site audits.

Each step: Alembic migration (or CLI/dashboard as noted) → `--sql` both
directions → `make test-backend` → `/preflight --remote-only` to confirm
the targeted advisors cleared → `/preflight --update-advisors-baseline` to
tighten the ratchet.
