---
status: shipped
last_reviewed: 2026-09-05
owner: '@raphaelfh'
---

# Entry identity end to end on a dedicated fixture project — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rename/re-key dialog and the section-description field are exercised end to end by Playwright, on a fixture project no other spec shares, so the two flows the identity train added (#801, #802) cannot regress silently and the shared fixture project's `config_draft_since` stays clean.

**Architecture:** PR 4 of the entry-group follow-up train ([spec §7](../specs/2026-09-03-entry-group-followup-train-design.md)). One more committed fixture identity (`IDENTITY_PROJECT_ID` + `IDENTITY_ARTICLE_ID`), provisioned by the idempotent `ensureFixtures` the way `PORTABLE_PROJECT_ID` is (owner as manager, CHARMS imported, one article with text). One serial spec in the `local-ui` Playwright project drives the run form's add + rename dialogs and the Configuration inspector's description textarea, and asserts the columns through the service-role `adminSelect` — the same evidence path `extraction-edit.ui.e2e.ts` uses. The created entry is registered with `recordResource` so global teardown deletes it; the description is restored through the same section PATCH so the fixture converges.

**Tech Stack:** Playwright (`@playwright/test`), the E2E fixture helpers under `frontend/e2e/_fixtures/`, PostgREST service-role reads.

**Spec:** [`docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md`](../specs/2026-09-03-entry-group-followup-train-design.md) §7 (PR 4), §9 (cleanup gate), §10 (verification).

## Global Constraints

- No backend or product code changes; frontend production code is untouched (fixtures and a spec only), so both knip modes stay at zero without a `knip.jsonc` entry — the `_fixtures` exports are consumed by the spec and the global setup.
- Zero-config: every new id ships in `fixture-ids.ts` and defaults through `env.ts`; the spec skips (never fails) when `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_SUPABASE_URL` or `E2E_SUPABASE_SERVICE_ROLE_KEY` is missing, as its siblings do.
- The spec lives in `frontend/e2e/flows/` and ends in `.ui.e2e.ts`, so `playwright.config.ts` routes it to `local-ui` unchanged; the two tests run serially (one login at a time, shared project).
- Locators are roles, labels, ids and `data-testid`s that exist today: `#entry-key`, `#entry-rename-label`, `#entry-rename-key`, the "Rename active {noun}" `aria-label`, `template-grid-section-row`, `#inspector-section-description`. No production `data-testid` is added.
- The local suite is stateful: verification runs once against a fresh `make db-fresh` (coordinate with any live peer session first — the local Supabase is one stack) with the backend and the frontend served from this worktree (assert the :8080 listener's cwd with `lsof -a -p <pid> -d cwd`).
- English only. Conventional commits. Frontend commands from the repo root.

---

### Task 1: The dedicated fixture project, and the add → rename → re-key flow

**Files:**
- Modify: `frontend/e2e/_fixtures/fixture-ids.ts` (after `PORTABLE_PROJECT_ID`), `frontend/e2e/_fixtures/env.ts` (type + loader), `frontend/e2e/_fixtures/ensure-fixtures.ts` (end of `ensureFixtures`)
- Create: `frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts`

**Interfaces:**
- Produces: `F.IDENTITY_PROJECT_ID = "e2e00001-0000-4000-8000-000000000003"`, `F.IDENTITY_ARTICLE_ID = "f00dc63a-6b47-42c3-8a93-af69eb28a1c5"`, `E2EEnvConfig.identityProjectId` / `.identityArticleId` (defaulted from `F`), and the project provisioned with CHARMS active. Task 2 adds its test to the same spec and reads `identityProjectId`.

- [ ] **Step 1: Write the spec (test 1) against the not-yet-provisioned project**

Create `frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts`:

```ts
/**
 * Entry identity, end to end (follow-up train §7).
 *
 * Runs on E2E_IDENTITY_PROJECT_ID — a dedicated CHARMS project no other
 * spec touches, because both flows leave state behind that the shared
 * fixture project's siblings assume clean: a description edit stamps the
 * template's `config_draft_since`, and an entry created through the run
 * form lives until teardown.
 *
 * 1. A reviewer adds a model through the entry dialog, then renames AND
 *    re-keys it: the row carries the new label, the new key, and one
 *    append-only history item (identity spec §5, constitution §IX).
 * 2. A manager edits a repeating section's description — its AI
 *    instruction (#802) — in the Configuration inspector; the column
 *    changes, and the same PATCH restores it so the fixture converges.
 */
import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { recordResource } from "../_fixtures/registry";
import { adminSelect, resolveActiveExtractionTemplateId } from "../_fixtures/supabase-admin";

const REQUIRED = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_SUPABASE_URL",
  "E2E_SUPABASE_SERVICE_ROLE_KEY",
];

interface ManualModelResponse {
  modelId: string;
  modelLabel: string;
  childInstances: Array<{ id: string }>;
}

interface InstanceRow {
  id: string;
  label: string;
  metadata: {
    entity_key?: string;
    entity_key_history?: Array<{ from: string | null; to: string }>;
  };
}

interface SectionRow {
  id: string;
  description: string | null;
}

// Both tests drive the same project; serial keeps one login at a time.
test.describe.configure({ mode: "serial" });

test.describe("Entry identity on a dedicated fixture project", () => {
  test("add a model, then rename and re-key it: label, key and history change", async ({
    page,
  }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);
    test.setTimeout(120_000);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${env.identityProjectId}/extraction/${env.identityArticleId}`,
    );
    await expect(page.locator('[data-scroll-container="extraction-form"]')).toBeVisible({
      timeout: 30_000,
    });

    // The selector's empty state offers "Add manually"; once an entry exists
    // the header's "New" button (titled "Add new {noun} manually") takes
    // over. The suite is stateful, so both must stay.
    const openAdd = page
      .getByRole("button", { name: /^add manually$/i })
      .or(page.locator('button[title^="Add new "][title$=" manually"]'));
    await openAdd.first().click();

    const dialog = page.getByRole("dialog");
    const name = `E2E model ${Date.now()}`;
    await dialog.locator("#entry-key").fill(name);
    const created = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/extraction/models/manual") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 30_000 },
    );
    await dialog.getByRole("button", { name: /^create /i }).click();
    const createdBody = await parseEnvelope<ManualModelResponse>(await created);
    expect(createdBody.ok).toBeTruthy();
    const modelId = createdBody.data.modelId;
    // Teardown deletes the parent; its singleton children and its decision
    // rows cascade (every FK onto extraction_instances is ON DELETE CASCADE).
    recordResource({ kind: "extraction_instance", id: modelId, note: name });

    const [before] = await adminSelect<InstanceRow>(
      "extraction_instances",
      `id=eq.${modelId}&select=id,label,metadata`,
    );
    expect(before.label).toBe(name);
    const keyBefore = before.metadata.entity_key;
    expect(keyBefore).toBeTruthy();

    // Rename + re-key the active entry through the one dialog (#801).
    await page.getByRole("button", { name: /^rename active /i }).click();
    const renamed = `${name} renamed`;
    await dialog.locator("#entry-rename-label").fill(renamed);
    await dialog.locator("#entry-rename-key").fill(`${name} rekeyed`);
    const patched = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/extraction/instances/${modelId}`) &&
        res.request().method() === "PATCH" &&
        res.ok(),
      { timeout: 30_000 },
    );
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await patched;

    const [after] = await adminSelect<InstanceRow>(
      "extraction_instances",
      `id=eq.${modelId}&select=id,label,metadata`,
    );
    expect(after.label).toBe(renamed);
    expect(after.metadata.entity_key).not.toBe(keyBefore);
    const history = after.metadata.entity_key_history ?? [];
    expect(history).toHaveLength(1);
    expect(history[0].from).toBe(keyBefore);
    expect(history[0].to).toBe(after.metadata.entity_key);
  });
});
```

- [ ] **Step 2: Run it to verify it fails for the right reason**

With the worktree's backend on :8000 and frontend on :8080 (see Global Constraints), run:

`npx playwright test frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts --project=local-ui --reporter=list`

Expected: FAIL — `env.identityProjectId` is `undefined`, so the navigation lands on `/projects/undefined/...` and the ready anchor never appears (or `loadE2EEnv` has no such key, a TypeScript error under Playwright's transform). Quote the failure.

- [ ] **Step 3: Add the identity and provision it**

`frontend/e2e/_fixtures/fixture-ids.ts`, after `PORTABLE_PROJECT_ID`:

```ts
/** Dedicated project for the entry-identity UI spec (rename/re-key + section
 * description). Provisioned WITH CHARMS; separate from the shared project
 * because a description edit stamps the template's `config_draft_since` and
 * a created entry lives until teardown — state the shared project's siblings
 * assume clean. */
export const IDENTITY_PROJECT_ID = "e2e00001-0000-4000-8000-000000000003";
export const IDENTITY_ARTICLE_ID = "f00dc63a-6b47-42c3-8a93-af69eb28a1c5";
```

`frontend/e2e/_fixtures/env.ts`: add `identityProjectId?: string;` and `identityArticleId?: string;` to `E2EEnvConfig` after `portableProjectId`, and in `loadE2EEnv()`:

```ts
    identityProjectId: process.env.E2E_IDENTITY_PROJECT_ID || F.IDENTITY_PROJECT_ID,
    identityArticleId: process.env.E2E_IDENTITY_ARTICLE_ID || F.IDENTITY_ARTICLE_ID,
```

`frontend/e2e/_fixtures/ensure-fixtures.ts`, at the end of `ensureFixtures()`:

```ts
  // Entry-identity flow: its own CHARMS project + article, because the spec
  // leaves a draft marker and a created entry behind.
  await ensureProject(F.IDENTITY_PROJECT_ID, "E2E Identity Project", ownerId);
  await ensureMembership(F.IDENTITY_PROJECT_ID, ownerId, "manager");
  await ensureArticle(F.IDENTITY_ARTICLE_ID, F.IDENTITY_PROJECT_ID, "E2E Identity Article");
  await ensureArticleText(F.IDENTITY_PROJECT_ID, F.IDENTITY_ARTICLE_ID);
  await ensureCharmsImported(F.IDENTITY_PROJECT_ID, ownerToken);
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx playwright test frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts --project=local-ui --reporter=list`
Expected: `1 passed`. Then confirm the fixture through the DB:

`docker exec supabase_db_supabase_local psql -U postgres -d postgres -tAc "select count(*) from public.projects where id='e2e00001-0000-4000-8000-000000000003'; select count(*) from public.project_extraction_templates where project_id='e2e00001-0000-4000-8000-000000000003' and is_active;"`

Expected: `1` and `1`.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/_fixtures/fixture-ids.ts frontend/e2e/_fixtures/env.ts frontend/e2e/_fixtures/ensure-fixtures.ts frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts
git commit -m "test(e2e): rename and re-key an entry on a dedicated identity fixture project"
```

---

### Task 2: The description edit in the Configuration inspector, restored through the same PATCH

**Files:**
- Modify: `frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts` (second test), `frontend/e2e/_fixtures/global-teardown.ts:resetDraftMarkers` (add the identity project)

**Interfaces:**
- Consumes: Task 1's `env.identityProjectId`; `adminSelect`, `resolveActiveExtractionTemplateId`, `authHeaders`, `createTraceId`, `resolveAuthToken` (all existing).
- Produces: nothing new; the teardown's draft-marker reset now covers the identity project.

- [ ] **Step 1: Write test 2**

Append inside the `test.describe(...)` block, after test 1:

```ts
  test("a manager edits a repeating section's description in the inspector", async ({
    page,
    request,
  }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);
    test.setTimeout(120_000);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const templateId = await resolveActiveExtractionTemplateId(env.identityProjectId!);
    const [section] = await adminSelect<SectionRow>(
      "extraction_entity_types",
      `project_template_id=eq.${templateId}&name=eq.final_predictors&select=id,description`,
    );
    expect(section, "CHARMS ships final_predictors").toBeDefined();
    const original = section.description ?? "";

    await page.goto(
      `${env.frontendUrl}/projects/${env.identityProjectId}?tab=extraction&extractionTab=configuration`,
      { waitUntil: "domcontentloaded" },
    );
    // The label button is the row's select target; the collapse toggle and
    // the actions menu carry the label inside a longer aria-label, so an
    // exact match reaches the button alone.
    await page
      .getByTestId("template-grid-section-row")
      .filter({ hasText: "Final Predictors" })
      .getByRole("button", { name: "Final Predictors", exact: true })
      .click();

    const textarea = page.locator("#inspector-section-description");
    await expect(textarea).toHaveValue(original);
    const edited = `${original} (e2e ${Date.now()})`.trim();
    // The restore runs whether or not the edit's assertions hold: nothing
    // re-syncs an existing project's section text (ensureCharmsImported
    // clones only when the template is missing), so a mutated description
    // would otherwise compound on every run.
    let restoreOk = false;
    try {
      const patched = page.waitForResponse(
        (res) =>
          res.url().includes(`/sections/${section.id}`) &&
          res.request().method() === "PATCH" &&
          res.ok(),
        { timeout: 30_000 },
      );
      await textarea.fill(edited);
      // The pane commits on blur (an immediate-commit control, no Save row).
      await textarea.blur();
      await patched;

      const [after] = await adminSelect<SectionRow>(
        "extraction_entity_types",
        `id=eq.${section.id}&select=id,description`,
      );
      expect(after.description).toBe(edited);
    } finally {
      // Converge the fixture through the same PATCH the inspector uses.
      const restore = await request.patch(
        `${env.apiUrl}/api/v1/projects/${env.identityProjectId}/templates/${templateId}/sections/${section.id}`,
        {
          headers: authHeaders(token, createTraceId("e2e-entry-identity")),
          data: { description: original },
          timeout: 15_000,
        },
      );
      restoreOk = restore.ok();
    }
    expect(restoreOk).toBeTruthy();
    const [restored] = await adminSelect<SectionRow>(
      "extraction_entity_types",
      `id=eq.${section.id}&select=id,description`,
    );
    expect(restored.description).toBe(section.description);
  });
```

- [ ] **Step 2: Run the spec (both tests)**

Run: `npx playwright test frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts --project=local-ui --reporter=list`
Expected: `2 passed`. If test 2 fails on the row locator, read the error-context a11y snapshot before touching the selector: a stale Vite module after a rename is the documented false negative.

- [ ] **Step 3: Cover the identity project in the teardown's draft reset**

In `frontend/e2e/_fixtures/global-teardown.ts`, `resetDraftMarkers`:

```ts
      `?project_id=in.(${F.PROJECT_ID},${F.IMPORT_PROJECT_ID},${F.IDENTITY_PROJECT_ID})`,
```

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts frontend/e2e/_fixtures/global-teardown.ts
git commit -m "test(e2e): a section description edit in the inspector, on the identity fixture project"
```

---

### Task 3: Gates, the full local suite on a fresh database, plan registration

**Files:**
- Modify: `.markdownlintignore` (this plan), `docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md` (§7.1 amendments if any)

- [ ] **Step 1: Static gates**

```bash
npm run lint
npm run typecheck
npx knip --no-tag-hints && npx knip --production --no-tag-hints
python3 scripts/fitness/check_copy_keys.py
```

Expected: all exit 0 (no production file changed; the new `_fixtures` exports are consumed).

- [ ] **Step 2: The full local suite, once, on a fresh database**

Confirm with any live peer session that the shared stack may be reset, then:

```bash
make db-fresh
docker exec supabase_db_supabase_local psql -U postgres -d postgres -tAc "select version_num from public.alembic_version; select count(*) from public.extraction_templates_global;"
pid=$(lsof -ti:8080 | head -1); lsof -a -p "$pid" -d cwd -Fn | grep '^n'
npm run test:e2e:local
```

Expected: the head is `0068_seeded_entry_nouns`, the catalogue count is ≥ 5, the :8080 cwd is this worktree, and the suite exits 0 with the new spec listed as 2 passed. Quote the summary line.

- [ ] **Step 3: Register the plan**

Append `docs/superpowers/plans/2026-09-04-entry-identity-e2e.md` to `.markdownlintignore`. If execution changed a detail of spec §7, add a `### 7.1 Amendments recorded at execution (2026-09-04)` list under §7 the way §5.1 does.

- [ ] **Step 4: Commit**

```bash
git add .markdownlintignore docs/superpowers/plans/2026-09-04-entry-identity-e2e.md docs/superpowers/specs/2026-09-03-entry-group-followup-train-design.md
git commit -m "docs(specs): register the entry-identity e2e plan"
```
