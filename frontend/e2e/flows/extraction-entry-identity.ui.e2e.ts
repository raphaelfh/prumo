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

type ManualModelResponse = {
  modelId: string;
  modelLabel: string;
};

type InstanceRow = {
  id: string;
  label: string;
  metadata: {
    entity_key?: string;
    entity_key_history?: Array<{ from: string | null; to: string }>;
  };
};

type SectionRow = {
  id: string;
  description: string | null;
};

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
    let restoreOk: boolean | undefined;
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
    expect(restoreOk).toBe(true);
    const [restored] = await adminSelect<SectionRow>(
      "extraction_entity_types",
      `id=eq.${section.id}&select=id,description`,
    );
    expect(restored.description).toBe(section.description);
  });
});
