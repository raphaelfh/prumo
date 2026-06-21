---
status: shipped
last_reviewed: 2026-05-30
owner: '@raphaelfh'
---

# Self-Provisioning E2E Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Playwright E2E suite ensure its own fixtures idempotently in `global-setup`, using committed canonical identities, so a fresh clone or post-`db-fresh` reset runs green/skip with zero manual provisioning.

**Architecture:** A new `ensure-fixtures.ts` module (idempotent create-if-missing functions over the existing `supabase-admin` PostgREST helpers + the clone API) is invoked by `global-setup.ts` after healthchecks. Identities live in a new `fixture-ids.ts`; `env.ts` defaults to them. Two tests are adjusted: LLM extraction gated behind an opt-in flag, and the template-import test uses its own CHARMS-free project.

**Tech Stack:** TypeScript, Playwright, Supabase local (GoTrue admin API + PostgREST), the prumo FastAPI clone endpoint.

**Spec:** [`docs/superpowers/specs/2026-05-30-e2e-fixture-self-provisioning-design.md`](../specs/2026-05-30-e2e-fixture-self-provisioning-design.md)

**Where to work:** the worktree `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/keen-archimedes-e4e843`. Run all `npx`/`npm`/`git`/`docker` commands from the **repo root** (`/Users/raphael/PycharmProjects/prumo` for the *main* checkout, or the worktree root for git). The local stack (backend `:8000`, frontend `:8080`, Supabase `:54321/:54322`) must be running.

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `frontend/e2e/_fixtures/fixture-ids.ts` | Canonical, committed fixture identities (emails, password, fixed UUIDs, fixture text). Single source of truth. | Create |
| `frontend/e2e/_fixtures/ensure-fixtures.ts` | Idempotent provisioner: `ensureUser/Project/Membership/Article/ArticleText/CharmsImported` + `ensureFixtures()`. | Create |
| `frontend/e2e/_fixtures/env.ts` | Default identity vars to the canonical constants; add `importProjectId`. | Modify |
| `frontend/e2e/_fixtures/global-setup.ts` | Call `ensureFixtures()` after healthchecks, before token resolution. | Modify |
| `frontend/e2e/flows/extraction.e2e.ts` | Gate the two LLM extraction tests behind `E2E_RUN_LLM_TESTS`. | Modify |
| `frontend/e2e/flows/template-import.ui.e2e.ts` | Use `env.importProjectId` instead of the shared project. | Modify |
| `.env.e2e.example` | Committed template documenting every `E2E_*` var + the local Supabase keys + the LLM opt-in. | Create |
| `docs/reference/tests.md` (or the existing testing reference) | Note fixtures are auto-provisioned + the `E2E_RUN_LLM_TESTS` opt-in. | Modify |

**Verification reality:** this is test-infra, so each task is verified by running the real suite/subset against the live stack + DB checks, not by isolated unit tests.

---

## Task 1: Canonical fixture identities

**Files:**

- Create: `frontend/e2e/_fixtures/fixture-ids.ts`

- [ ] **Step 1: Create the constants file**

```ts
/**
 * Canonical, committed E2E fixture identities — the single source of truth.
 * Non-personal and deterministic so the suite self-provisions with zero
 * manual setup. User UUIDs are NOT pinned (Supabase generates them on
 * admin-create); only project/article IDs are fixed because tests reference
 * them directly via env. Passwords/keys here are LOCAL-ONLY test values.
 */
export const FIXTURE_PASSWORD = "E2eFixture!Pass123";

export const OWNER_EMAIL = "e2e-owner@prumo.test";
export const REVIEWER_B_EMAIL = "e2e-reviewer-b@prumo.test";
export const REVIEWER_C_EMAIL = "e2e-reviewer-c@prumo.test";

/** Main project the extraction/HITL/QA tests operate on (CHARMS imported). */
export const PROJECT_ID = "5b9d8976-6da5-45e4-84a5-380a40fdbb0b";
export const ARTICLE_ID = "f00dc63a-6b47-42c3-8a93-af69eb28a1c0";

/** Dedicated project for the template-import test — intentionally CHARMS-free. */
export const IMPORT_PROJECT_ID = "e2e00001-0000-4000-8000-000000000001";

/** Fixed global-catalogue ids (match backend/app/seed.py). */
export const CHARMS_GLOBAL_TEMPLATE_ID = "000c0000-0000-0000-0000-000000000001";
export const PROBAST_GLOBAL_TEMPLATE_ID = "00b00000-0000-0000-0000-000000000001";

/** Plausible study text so AI extraction has grounded input (LLM opt-in). */
export const FIXTURE_ARTICLE_BLOCKS = [
  "We developed a prognostic model to predict 30-day mortality in adults admitted with community-acquired pneumonia.",
  "A retrospective cohort of 1,240 patients from two tertiary hospitals was used for development; candidate predictors included age, sex, CRP, urea, and respiratory rate.",
  "The model was fitted with logistic regression; discrimination was assessed by the c-statistic and calibration by the calibration slope.",
];
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/raphael/PycharmProjects/prumo && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: exit 0 (no errors). If `frontend/tsconfig.json` does not exist, use the repo's TS config: `npx tsc --noEmit` from root.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/_fixtures/fixture-ids.ts
git commit -m "test(e2e): canonical fixture identities module"
```

---

## Task 2: Default env to the canonical identities

**Files:**

- Modify: `frontend/e2e/_fixtures/env.ts`

- [ ] **Step 1: Import the constants and add defaults**

At the top of `frontend/e2e/_fixtures/env.ts` add the import:

```ts
import * as F from "./fixture-ids";
```

Add `importProjectId` to the `E2EEnvConfig` type (after `projectId`):

```ts
  projectId?: string;
  importProjectId?: string;
```

In `loadE2EEnv()`, change the identity fields to fall back to the canonical constants (leave `supabaseUrl`/keys untouched — they stay env-sourced and hard-fail in `supabase-admin` if missing):

```ts
    userEmail: process.env.E2E_USER_EMAIL || F.OWNER_EMAIL,
    userPassword: process.env.E2E_USER_PASSWORD || F.FIXTURE_PASSWORD,
    rateLimitEmail: process.env.E2E_RATE_LIMIT_EMAIL || F.REVIEWER_B_EMAIL,
    rateLimitPassword: process.env.E2E_RATE_LIMIT_PASSWORD || F.FIXTURE_PASSWORD,
    reviewerCEmail: process.env.E2E_REVIEWER_C_EMAIL || F.REVIEWER_C_EMAIL,
    reviewerCPassword: process.env.E2E_REVIEWER_C_PASSWORD || F.FIXTURE_PASSWORD,
    projectId: process.env.E2E_PROJECT_ID || F.PROJECT_ID,
    importProjectId: process.env.E2E_IMPORT_PROJECT_ID || F.IMPORT_PROJECT_ID,
    articleId: process.env.E2E_ARTICLE_ID || F.ARTICLE_ID,
```

Leave the other fields (`authToken`, `templateId`, `supabaseUrl`, `supabaseAnonKey`, `supabaseServiceRoleKey`, etc.) exactly as they are.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/raphael/PycharmProjects/prumo && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/_fixtures/env.ts
git commit -m "test(e2e): default identity env to canonical fixtures + importProjectId"
```

---

## Task 3: The idempotent provisioner

**Files:**

- Create: `frontend/e2e/_fixtures/ensure-fixtures.ts`

- [ ] **Step 1: Create the provisioner**

```ts
/**
 * Idempotent E2E fixture provisioner. Creates-if-missing the full fixture
 * graph so the suite self-provisions on every run (reset-proof, zero-config).
 * Built on the service-role PostgREST helpers (RLS-bypassing) + the clone API.
 */
import { adminInsert, adminSelect } from "./supabase-admin";
import { loadE2EEnv } from "./env";
import * as F from "./fixture-ids";

/** Create the auth user if absent; resolve its id via password-grant login otherwise. */
async function ensureUser(email: string, password: string): Promise<string> {
  const env = loadE2EEnv();
  const base = env.supabaseUrl!;
  const svc = env.supabaseServiceRoleKey!;
  const anon = env.supabaseAnonKey!;
  const createRes = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (createRes.ok) {
    return ((await createRes.json()) as { id: string }).id;
  }
  // Already exists (or transient) → resolve id by logging in.
  const tokRes = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (tokRes.ok) {
    const body = (await tokRes.json()) as { user?: { id?: string } };
    if (body.user?.id) return body.user.id;
  }
  throw new Error(
    `ensureUser(${email}) failed: create=${createRes.status} login=${tokRes.status} ${await tokRes.text()}`,
  );
}

async function login(email: string, password: string): Promise<string> {
  const env = loadE2EEnv();
  const res = await fetch(`${env.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.supabaseAnonKey!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login(${email}) failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function ensureProject(id: string, name: string, ownerProfileId: string): Promise<void> {
  const existing = await adminSelect("projects", `id=eq.${id}&select=id`);
  if (existing.length > 0) return;
  await adminInsert("projects", [{ id, name, created_by_id: ownerProfileId }]);
}

async function ensureMembership(projectId: string, userId: string, role: string): Promise<void> {
  const existing = await adminSelect(
    "project_members",
    `project_id=eq.${projectId}&user_id=eq.${userId}&select=id`,
  );
  if (existing.length > 0) return;
  await adminInsert("project_members", [{ project_id: projectId, user_id: userId, role }]);
}

async function ensureArticle(id: string, projectId: string, title: string): Promise<void> {
  const existing = await adminSelect("articles", `id=eq.${id}&select=id`);
  if (existing.length > 0) return;
  await adminInsert("articles", [{ id, project_id: projectId, title }]);
}

/** Seed an article_files row + text blocks so AI extraction (opt-in) has input. */
async function ensureArticleText(projectId: string, articleId: string): Promise<void> {
  const files = await adminSelect<{ id: string }>(
    "article_files",
    `article_id=eq.${articleId}&select=id`,
  );
  let fileId: string;
  if (files.length > 0) {
    fileId = files[0].id;
  } else {
    const inserted = await adminInsert<{ id: string }>("article_files", [
      {
        project_id: projectId,
        article_id: articleId,
        file_type: "pdf",
        storage_key: `e2e-fixtures/${articleId}.pdf`,
        file_role: "main",
        original_filename: "e2e-fixture.pdf",
        text_raw: F.FIXTURE_ARTICLE_BLOCKS.join("\n\n"),
        extraction_status: "completed",
      },
    ]);
    fileId = inserted[0].id;
  }
  const blocks = await adminSelect("article_text_blocks", `article_file_id=eq.${fileId}&select=id&limit=1`);
  if (blocks.length > 0) return;
  await adminInsert(
    "article_text_blocks",
    F.FIXTURE_ARTICLE_BLOCKS.map((text, i) => ({
      article_file_id: fileId,
      page_number: 1,
      block_index: i,
      text,
      char_start: 0,
      char_end: text.length,
      bbox: {},
      block_type: "paragraph",
    })),
  );
}

async function ensureCharmsImported(projectId: string, ownerToken: string): Promise<void> {
  const env = loadE2EEnv();
  const existing = await adminSelect(
    "project_extraction_templates",
    `project_id=eq.${projectId}&kind=eq.extraction&is_active=eq.true&select=id&limit=1`,
  );
  if (existing.length > 0) return;
  const res = await fetch(`${env.apiUrl}/api/v1/projects/${projectId}/templates/clone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/json",
      "X-Trace-Id": "e2e-ensure-charms",
    },
    body: JSON.stringify({ global_template_id: F.CHARMS_GLOBAL_TEMPLATE_ID, kind: "extraction" }),
  });
  if (!res.ok) {
    throw new Error(`ensureCharmsImported(${projectId}) failed: ${res.status} ${await res.text()}`);
  }
}

/** Ensure the entire E2E fixture graph. Safe to run on every suite startup. */
export async function ensureFixtures(): Promise<void> {
  const ownerId = await ensureUser(F.OWNER_EMAIL, F.FIXTURE_PASSWORD);
  const reviewerBId = await ensureUser(F.REVIEWER_B_EMAIL, F.FIXTURE_PASSWORD);
  const reviewerCId = await ensureUser(F.REVIEWER_C_EMAIL, F.FIXTURE_PASSWORD);

  // Main project: owner manages; reviewers B & C can record decisions.
  await ensureProject(F.PROJECT_ID, "E2E Test Project", ownerId);
  await ensureMembership(F.PROJECT_ID, ownerId, "manager");
  await ensureMembership(F.PROJECT_ID, reviewerBId, "reviewer");
  await ensureMembership(F.PROJECT_ID, reviewerCId, "reviewer");
  await ensureArticle(F.ARTICLE_ID, F.PROJECT_ID, "E2E Fixture Article");
  await ensureArticleText(F.PROJECT_ID, F.ARTICLE_ID);
  const ownerToken = await login(F.OWNER_EMAIL, F.FIXTURE_PASSWORD);
  await ensureCharmsImported(F.PROJECT_ID, ownerToken);

  // Import-test project: owner only, intentionally NO CHARMS.
  await ensureProject(F.IMPORT_PROJECT_ID, "E2E Import Project", ownerId);
  await ensureMembership(F.IMPORT_PROJECT_ID, ownerId, "manager");
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/raphael/PycharmProjects/prumo && npx tsc --noEmit -p frontend/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit** (verified together with Task 4, since the provisioner only runs via global-setup)

```bash
git add frontend/e2e/_fixtures/ensure-fixtures.ts
git commit -m "test(e2e): idempotent fixture provisioner (ensure-fixtures)"
```

---

## Task 4: Hook the provisioner into global-setup + verify against a clean DB

**Files:**

- Modify: `frontend/e2e/_fixtures/global-setup.ts`

- [ ] **Step 1: Import and call `ensureFixtures`**

Add the import near the top of `frontend/e2e/_fixtures/global-setup.ts`:

```ts
import { ensureFixtures } from "./ensure-fixtures";
```

Inside `globalSetup`, immediately after the two `waitForHealthcheck(...)` calls and before the `E2E_AUTH_TOKEN` resolution block, insert:

```ts
  // Ensure all fixtures exist before resolving tokens (which log users in).
  await ensureFixtures();
```

- [ ] **Step 2: Reset the DB to prove provisioning from scratch**

Run: `cd /Users/raphael/PycharmProjects/prumo && make db-fresh`
Expected: ends with "Schema em head, seed aplicado, dados base presentes." (global templates only; no E2E fixtures yet).

Then ensure the backend is running and on the current schema (db-fresh does not restart it):
Run: `lsof -ti:8000 | xargs kill -9 2>/dev/null; (cd /Users/raphael/PycharmProjects/prumo/backend && env -u DATABASE_URL -u DIRECT_DATABASE_URL -u SUPABASE_DATABASE_URL uv run uvicorn app.main:app --reload --port 8000 >/tmp/prumo-backend.log 2>&1 &)` then `curl --retry 20 --retry-delay 1 --retry-all-errors -fsS -o /dev/null -w "%{http_code}\n" http://localhost:8000/health`
Expected: `200`.

- [ ] **Step 3: Trigger global-setup via a smoke test and confirm fixtures appear**

Run: `cd /Users/raphael/PycharmProjects/prumo && npx playwright test frontend/e2e/flows/auth.e2e.ts --project=local-ui --reporter=list 2>&1 | tail -15`
Expected: the auth login test **passes** (global-setup created the owner user + project, login works).

Verify the DB rows:
Run: `docker exec -i supabase_db_supabase_local psql -U postgres -d postgres -tA -c "SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'e2e-%@prumo.test') AS users, (SELECT count(*) FROM projects WHERE id IN ('5b9d8976-6da5-45e4-84a5-380a40fdbb0b','e2e00001-0000-4000-8000-000000000001')) AS projects, (SELECT count(*) FROM project_members WHERE project_id='5b9d8976-6da5-45e4-84a5-380a40fdbb0b') AS members, (SELECT count(*) FROM article_text_blocks atb JOIN article_files af ON af.id=atb.article_file_id WHERE af.article_id='f00dc63a-6b47-42c3-8a93-af69eb28a1c0') AS blocks, (SELECT count(*) FROM project_extraction_templates WHERE project_id='5b9d8976-6da5-45e4-84a5-380a40fdbb0b' AND is_active) AS charms;"`
Expected: `users=3`, `projects=2`, `members=3`, `blocks=3`, `charms=1`.

- [ ] **Step 4: Prove idempotency**

Run the smoke test again (no reset): `cd /Users/raphael/PycharmProjects/prumo && npx playwright test frontend/e2e/flows/auth.e2e.ts --project=local-ui --reporter=list 2>&1 | tail -5`
Expected: still passes, no "already exists"/duplicate errors in global-setup. Re-run the SQL from Step 3 — counts unchanged (`users=3`, `projects=2`, `members=3`, `blocks=3`, `charms=1`).

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/_fixtures/global-setup.ts
git commit -m "test(e2e): self-provision fixtures in global-setup"
```

---

## Task 5: Gate the LLM extraction tests behind an opt-in

**Files:**

- Modify: `frontend/e2e/flows/extraction.e2e.ts`

- [ ] **Step 1: Skip the two LLM tests unless `E2E_RUN_LLM_TESTS` is set**

In `frontend/e2e/flows/extraction.e2e.ts`, the test `runs model and section extraction through API` (around line 27) currently skips only on missing project/article env. Add an LLM opt-in guard as the **first** line of that test body (immediately inside the `async ({ request, page }) => {`):

```ts
    test.skip(!process.env.E2E_RUN_LLM_TESTS, "LLM extraction is opt-in: set E2E_RUN_LLM_TESTS=1 (and OPENAI_API_KEY) to run.");
```

Add the **same** line as the first line of any other test in this file that calls `/api/v1/extraction/models` or `/api/v1/extraction/sections` with a real model (i.e., the model/section happy-path test). Do NOT add it to the negative test `rejects section extraction when article id is invalid` (that asserts a 4xx and needs no LLM).

- [ ] **Step 2: Verify the LLM test now skips (no flag)**

Run: `cd /Users/raphael/PycharmProjects/prumo && npx playwright test frontend/e2e/flows/extraction.e2e.ts --project=local-api --reporter=list 2>&1 | tail -15`
Expected: `runs model and section extraction through API` shows as **skipped**; `opens extraction fullscreen route` and `rejects section extraction when article id is invalid` **pass**.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/flows/extraction.e2e.ts
git commit -m "test(e2e): gate LLM extraction tests behind E2E_RUN_LLM_TESTS"
```

---

## Task 6: Point template-import at its own project

**Files:**

- Modify: `frontend/e2e/flows/template-import.ui.e2e.ts`

- [ ] **Step 1: Use `env.importProjectId`**

In `frontend/e2e/flows/template-import.ui.e2e.ts`, the test navigates to `${env.frontendUrl}/projects/${env.projectId}?tab=extraction&...`. Replace **every** use of `env.projectId` in this file with `env.importProjectId`. Also update the `missingEnvKeys([...])` guard: replace `"E2E_PROJECT_ID"` with `"E2E_IMPORT_PROJECT_ID"` is NOT needed (both default now), so instead leave the guard checking `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` only — remove `"E2E_PROJECT_ID"` from the required list since the import project is always ensured.

Concretely, change the guard to:

```ts
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
    ]);
```

and the navigation/usage lines from `env.projectId` to `env.importProjectId`.

- [ ] **Step 2: Verify the import test passes against the empty project**

Run: `cd /Users/raphael/PycharmProjects/prumo && npx playwright test frontend/e2e/flows/template-import.ui.e2e.ts --project=local-ui --reporter=list 2>&1 | tail -15`
Expected: `imports CHARMS from configuration and shows success` **passes** (the import project has no CHARMS, so the clone POST fires and succeeds).

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/flows/template-import.ui.e2e.ts
git commit -m "test(e2e): template-import uses its own CHARMS-free project"
```

---

## Task 7: Committed example env + docs + memory

**Files:**

- Create: `.env.e2e.example`
- Modify: the testing reference under `docs/reference/` (e.g. `docs/reference/tests.md`)
- Modify: `~/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/project_local_e2e_fixtures_not_seeded.md`

- [ ] **Step 1: Create `.env.e2e.example`**

Get the local Supabase keys (printed by the running stack):
Run: `cd /Users/raphael/PycharmProjects/prumo/supabase && supabase status`
Copy the `anon key` and `service_role key` values into the file below (they are the fixed local-dev demo keys, not secrets):

```bash
# .env.e2e — copy to .env.e2e for local E2E (or rely on defaults for identities).
# The Playwright suite SELF-PROVISIONS users/project/article/CHARMS in
# global-setup, so identities below are OPTIONAL (defaults live in
# frontend/e2e/_fixtures/fixture-ids.ts). You only NEED the Supabase keys.

E2E_FRONTEND_URL=http://127.0.0.1:8080
E2E_API_URL=http://127.0.0.1:8000

# Local Supabase (from `supabase status`) — required for fixture provisioning.
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_ANON_KEY=<paste local anon key from `supabase status`>
E2E_SUPABASE_SERVICE_ROLE_KEY=<paste local service_role key from `supabase status`>

# Identities (optional — default to canonical fixtures):
# E2E_USER_EMAIL=e2e-owner@prumo.test
# E2E_USER_PASSWORD=E2eFixture!Pass123

# Opt-in: run the (paid) AI-extraction tests. Needs a real key.
# E2E_RUN_LLM_TESTS=1
# OPENAI_API_KEY=sk-...
```

- [ ] **Step 2: Document in the testing reference**

Find the testing reference: `ls docs/reference/ | grep -i test`. In that file (e.g. `docs/reference/tests.md`), add a short section:

```markdown
## Local E2E fixtures (auto-provisioned)

`frontend/e2e/_fixtures/global-setup.ts` calls `ensureFixtures()`, which
idempotently creates the test users, project, article (+ seeded text), and
clones CHARMS — so a fresh clone or `make db-fresh` runs `npm run test:e2e:local`
with no manual setup. Identities are committed in `fixture-ids.ts`; only the
local Supabase keys are read from env (`.env`/`.env.e2e`, see `.env.e2e.example`).
The AI-extraction tests are opt-in: set `E2E_RUN_LLM_TESTS=1` + `OPENAI_API_KEY`.
```

If no testing reference file exists, create `docs/reference/tests.md` with the heading `# Tests` followed by that section.

- [ ] **Step 3: Update the memory note (gap now closed)**

In `~/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/project_local_e2e_fixtures_not_seeded.md`, append at the end of the body:

```markdown

**UPDATE (2026-05-30):** Closed. `frontend/e2e/_fixtures/ensure-fixtures.ts` (called by `global-setup.ts`) now self-provisions all fixtures idempotently from committed identities (`fixture-ids.ts`). `make db-fresh` followed by `npm run test:e2e:local` is green/skip with no manual step. Reset no longer breaks the suite.
```

- [ ] **Step 4: Commit**

```bash
git add .env.e2e.example docs/reference/
git commit -m "docs(e2e): document auto-provisioned fixtures + .env.e2e.example"
```

(The memory file lives outside the repo — it is saved directly, not committed.)

---

## Task 8: Full acceptance run

**Files:** none (verification only)

- [ ] **Step 1: Clean-slate run, keyless**

Run: `cd /Users/raphael/PycharmProjects/prumo && make db-fresh` then restart the backend (Task 4 Step 2 commands) then `npm run test:e2e:local > /tmp/e2e-accept.log 2>&1; echo "EXIT=$?"`
Inspect: `grep -E "EXIT=|[0-9]+ (passed|failed|skipped)" /tmp/e2e-accept.log | tail -6`
Expected: **0 failed**; the LLM extraction test(s) reported as **skipped**; everything else passed.

- [ ] **Step 2 (optional, needs a key): LLM path**

Run: `cd /Users/raphael/PycharmProjects/prumo && E2E_RUN_LLM_TESTS=1 OPENAI_API_KEY=<real key> npx playwright test frontend/e2e/flows/extraction.e2e.ts --project=local-api --reporter=list 2>&1 | tail -10`
Expected: the model/section extraction test **passes** (article text was seeded).

- [ ] **Step 3: Lint the changed frontend files**

Run: `cd /Users/raphael/PycharmProjects/prumo && npx eslint frontend/e2e/_fixtures/fixture-ids.ts frontend/e2e/_fixtures/ensure-fixtures.ts frontend/e2e/_fixtures/env.ts frontend/e2e/_fixtures/global-setup.ts frontend/e2e/flows/extraction.e2e.ts frontend/e2e/flows/template-import.ui.e2e.ts`
Expected: exit 0.

---

## Self-Review

**1. Spec coverage:**

- §3.1 fixture-ids → Task 1. ✅
- §3.2 ensure-fixtures (all six ensure* + ensureFixtures, FK order, article_files→text_blocks) → Task 3. ✅
- §3.3 global-setup hook (after healthchecks, before token resolution) → Task 4 Step 1. ✅
- §3.4 env defaults + importProjectId → Task 2. ✅
- §3.5 `.env.e2e.example` → Task 7 Step 1. ✅
- §4 LLM opt-in gate → Task 5; template-import own project → Task 6; consensus via reviewer memberships → Task 3 `ensureFixtures` (reviewer B & C as `reviewer`). ✅
- §5 idempotency → Task 4 Step 4; hard-fail on missing keys → inherited from `supabase-admin.admin()` + `ensureUser`. ✅
- §6 out of scope (no app/schema changes, no make target) → respected. ✅
- §7 acceptance (keyless green/skip + optional key path + idempotent re-run) → Task 8 + Task 4 Step 4. ✅
- §8 files touched → all appear. ✅

**2. Placeholder scan:** No "TBD"/"handle errors" — every code step is complete. The two `<paste …>` tokens in Task 7 Step 1 and `<real key>` in Task 8 Step 2 are explicit "obtain this concrete value via the given command" instructions, not unspecified logic.

**3. Type/name consistency:** `ensureFixtures`, `ensureUser/Project/Membership/Article/ArticleText/CharmsImported`, `F.OWNER_EMAIL/REVIEWER_B_EMAIL/REVIEWER_C_EMAIL/FIXTURE_PASSWORD/PROJECT_ID/ARTICLE_ID/IMPORT_PROJECT_ID/CHARMS_GLOBAL_TEMPLATE_ID/FIXTURE_ARTICLE_BLOCKS`, and `env.importProjectId` are used identically across Tasks 1–6. `adminInsert`/`adminSelect` signatures match `supabase-admin.ts`. ✅
