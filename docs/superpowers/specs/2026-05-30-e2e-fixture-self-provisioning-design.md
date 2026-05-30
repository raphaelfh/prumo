---
status: draft
last_reviewed: 2026-05-30
owner: '@raphaelfh'
---

> **Status:** Draft · 2026-05-30 · Owner: @raphaelfh
> Frontend E2E test-infra change. No app schema/API changes.

# Design: Self-Provisioning E2E Fixtures

**Date:** 2026-05-30
**Scope:** Playwright E2E harness (`frontend/e2e/`) + a committed example env + docs. No application code, DB schema, or API changes.

## 1. Context

The local Playwright E2E suite depends on fixtures that **nothing seeds**: three Supabase auth users, a project the user manages, an article in it, and CHARMS cloned into that project — with IDs/emails pinned in each dev's private (gitignored) `.env`. `app.seed` only creates the global templates (CHARMS/PROBAST/QUADAS-2); `frontend/e2e/_fixtures/global-setup.ts` only *logs the user in* (it never creates anything); there is no `.env.e2e`.

Consequences, both hit on 2026-05-30:
- A full local DB reset (`make db-fresh`) wipes the fixtures and the suite collapses (3 pass / 31 fail) until they are re-provisioned by hand.
- A brand-new dev has no fixtures at all, so the suite cannot authenticate.

This spec makes the suite **self-provisioning**: it ensures its own fixtures, idempotently, on every run, using committed deterministic identities — so a fresh clone or a post-reset run "just works" with zero manual setup. See the recorded gotcha at `~/.claude/.../memory/project_local_e2e_fixtures_not_seeded.md`.

## 2. Decision

1. **Activation: self-provisioning `global-setup`.** Provisioning runs inside the existing Playwright `globalSetup`, not as a separate command. It is inherently idempotent and reset-proof, and needs no step a dev can forget.
2. **Identity: committed canonical test identities.** The fixtures use non-personal, deterministic values baked into the suite (emails, a local-only password, fixed project/article UUIDs). The personal account (`raphael_haddad@outlook.com`) leaves the test path. `.env` may still override.
3. **Scope: full — honest green/skip for everyone.** Provision the base fixtures **plus** reviewer memberships and seeded article text, **plus** two principled test tweaks so a new dev sees an all-green-or-skipped suite, never mystery reds.

## 3. Architecture & components

Each unit is small with one responsibility.

### 3.1 `frontend/e2e/_fixtures/fixture-ids.ts` — canonical identities (source of truth)
Exports the deterministic fixture constants:
- Emails: `e2e-owner@prumo.test` (manager), `e2e-reviewer-b@prumo.test` (2nd reviewer; doubles as the rate-limit-burst user), `e2e-reviewer-c@prumo.test` (3rd reviewer).
- A single local-only `E2E_FIXTURE_PASSWORD`.
- Fixed UUIDs: `PROJECT_ID`, `ARTICLE_ID`, and a separate `IMPORT_PROJECT_ID` (for the template-import test).
- Re-exports the existing fixed global-template IDs (CHARMS `000c0000-…`, PROBAST `00b00000-…`).

User UUIDs are **not** pinned — Supabase generates them on admin-create; the suite resolves them by email/login (the existing `E2E_USER_ID` auto-resolve already does this).

### 3.2 `frontend/e2e/_fixtures/ensure-fixtures.ts` — the idempotent provisioner
Pure "ensure" (create-if-missing) functions built on the existing `supabase-admin.ts` helpers (`adminInsert`/`adminSelect`/`adminRpc`, service-role → bypasses RLS) and the clone API. Each tolerates "already exists" and returns the resolved id.

Order (respects FKs):
1. `ensureUser(email, password)` → Supabase admin `POST /auth/v1/admin/users` (`email_confirm: true`); on "already registered", resolve the id via admin lookup. The `handle_new_user` trigger creates the `profiles` row.
2. `ensureProject(id, name, ownerProfileId)` → upsert `projects` (`name`, `created_by_id → profiles.id`).
3. `ensureMembership(projectId, userId, role)` → upsert `project_members` (`role ∈ manager|reviewer`). Owner = `manager`; reviewer-B and reviewer-C = `reviewer`.
4. `ensureArticle(id, projectId, title)` → upsert `articles` (`project_id`, `title`).
5. `ensureArticleText(articleId)` → upsert one `article_files` row, then a few `article_text_blocks` for it (`article_file_id`, `page_number`, `block_index`, `text`, `char_start`, `char_end`, `bbox`, `block_type`) so AI extraction has grounded text. (Text blocks hang off `article_file_id`, not the article directly.)
6. `ensureCharmsImported(projectId, ownerToken)` → `POST /api/v1/projects/{id}/templates/clone` (`kind=extraction`), already idempotent server-side. **Only** for the main `PROJECT_ID` — never for `IMPORT_PROJECT_ID`.

A top-level `ensureFixtures()` runs the whole graph: owner+reviewers, main project (+member+article+text+CHARMS), and the empty import project (+owner membership, no CHARMS).

### 3.3 `frontend/e2e/_fixtures/global-setup.ts` — hook
After the existing healthchecks and **before** token resolution, call `await ensureFixtures()`. Token resolution then logs in users guaranteed to exist. The existing zombie-fixture sweep stays.

### 3.4 `frontend/e2e/_fixtures/env.ts` — defaults
`loadE2EEnv()` defaults `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, the reviewer emails/passwords, `E2E_PROJECT_ID`, `E2E_ARTICLE_ID`, and the new `E2E_IMPORT_PROJECT_ID` to the canonical constants from §3.1. With no `.env`, the suite uses canonical fixtures; `.env` still overrides (e.g., a real `OPENAI_API_KEY`).

### 3.5 `.env.e2e.example` (committed)
Documents every `E2E_*` var, notes that all are defaulted (so usually nothing is needed locally), and the one opt-in for the LLM test (`OPENAI_API_KEY` + `E2E_RUN_LLM_TESTS=1`).

## 4. Test tweaks (full-green scope)

- **`extraction.e2e.ts`** model/section tests → gate behind an explicit `E2E_RUN_LLM_TESTS` opt-in (`test.skip` unless truthy). These cost money and need a key; default is **skip**. `ensureArticleText` makes them pass when enabled with a key.
- **`template-import.ui.e2e.ts`** → point at `E2E_IMPORT_PROJECT_ID` (the ensured CHARMS-free project) instead of the shared `E2E_PROJECT_ID`, so it can import CHARMS fresh. Resolves the shared-project conflict.
- **Consensus** (`qa-multi-reviewer-consensus.api.e2e.ts`) → fixed purely by the new reviewer-B/reviewer-C memberships (§3.2 step 3); no test change.

## 5. Idempotency & error handling

- Every `ensure*` is safe to run repeatedly (upsert on PK / tolerate "already exists"). Re-running the suite re-ensures with no duplicates.
- Hard-fail with a clear message if `E2E_SUPABASE_URL` / `E2E_SUPABASE_SERVICE_ROLE_KEY` are missing (provisioning is impossible without them).
- Surface (do not swallow) a failed CHARMS clone — extraction/HITL tests depend on it.

## 6. Out of scope

- Application code, DB schema, API, or RLS changes.
- A Makefile target (self-provisioning `global-setup` supersedes it; `make db-fresh` + `make e2e-local` already chains correctly).
- Seeding a real PDF binary into Storage — text is seeded via `article_text_blocks`, which is what AI extraction reads.
- Remote/CI-secret provisioning beyond honoring the same env vars.

## 7. Acceptance

From a clean `make db-fresh`:
- `npm run test:e2e:local` (no key) → **all green with the LLM extraction tests skipped**; no manual `.env` setup.
- `E2E_RUN_LLM_TESTS=1` + a valid `OPENAI_API_KEY` → **fully green** (no skips for the LLM tests).
- Re-running the suite immediately (no reset) is still green — proving idempotency.

## 8. Files touched

- Create: `frontend/e2e/_fixtures/fixture-ids.ts`, `frontend/e2e/_fixtures/ensure-fixtures.ts`, `.env.e2e.example`.
- Modify: `frontend/e2e/_fixtures/global-setup.ts`, `frontend/e2e/_fixtures/env.ts`, `frontend/e2e/flows/extraction.e2e.ts`, `frontend/e2e/flows/template-import.ui.e2e.ts`.
- Docs: `docs/reference/` testing reference (auto-provisioned fixtures + the `E2E_RUN_LLM_TESTS` opt-in); update the `project_local_e2e_fixtures_not_seeded` memory to note the gap is now closed.

## 9. References

- Gotcha that motivated this: `memory/project_local_e2e_fixtures_not_seeded.md`.
- Existing harness: `frontend/e2e/_fixtures/{global-setup,env,supabase-admin,hitl}.ts`.
- Clone API + idempotency: `docs/reference/extraction-hitl-architecture.md` §4.2.
