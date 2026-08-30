// frontend/e2e/flows/template-portable.ui.e2e.ts
import {readFile} from 'node:fs/promises';

import {expect, test} from '@playwright/test';

import {loginViaUi} from '../_fixtures/auth';
import {loadE2EEnv, missingEnvKeys} from '../_fixtures/env';

/**
 * Export → import (renamed, with a unique first-section label) → the grid
 * renders the IMPORTED structure → switch back → delete the import. Runs on
 * PORTABLE_PROJECT_ID, provisioned with CHARMS by global setup, so the
 * config editor (and its export button) is mounted from the first paint.
 */
test.describe('Portable template import/export', () => {
  test('round-trips a template through a file and cleans up', async ({page}) => {
    test.setTimeout(180_000);
    const required = missingEnvKeys(['E2E_USER_EMAIL', 'E2E_USER_PASSWORD']);
    test.skip(required.length > 0, `Missing required env: ${required.join(', ')}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${env.portableProjectId}?tab=extraction&extractionTab=configuration`,
      {waitUntil: 'domcontentloaded'},
    );

    const exportButton = page.getByTestId('template-config-export');
    await expect(exportButton).toBeVisible({timeout: 60_000});

    // Export → capture the file.
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const maybeConfirm = page.getByTestId('template-config-export-confirm');
    if (await maybeConfirm.isVisible().catch(() => false)) await maybeConfirm.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.prumo-template\.json$/);
    const doc = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(doc.prumo_template).toBe(1);
    expect(doc).not.toHaveProperty('data');

    // Import it back under a new name, with a first-section label that
    // exists NOWHERE in the original — the grid assertion below must prove
    // it renders the imported structure, not the old one.
    const stamp = Date.now();
    const renamed = structuredClone(doc);
    renamed.name = `E2E import ${stamp}`;
    renamed.sections[0].label = `Imported section ${stamp}`;
    await page.getByTestId('template-config-open-import').first().click();
    // One pane renders at a time now: Radix drops the inactive panes from the
    // DOM, so each pane must be activated before its controls exist.
    await page.getByTestId('import-template-tab-file').click();
    await page.getByTestId('import-template-file-input').setInputFiles({
      name: 'x.prumo-template.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(renamed)),
    });
    await page.getByTestId('import-template-file-submit').click();
    await expect(page.getByTestId('import-template-dialog')).toBeHidden({timeout: 60_000});
    await expect(page.getByText(`Imported section ${stamp}`).first()).toBeVisible({timeout: 60_000});

    // Switch back to the original, then delete the import.
    await page.getByTestId('template-config-open-import').first().click();
    await page.getByTestId('import-template-tab-project').click();
    const importedRow = page
      .locator('[data-testid^="project-template-row-"]')
      .filter({hasText: renamed.name});
    await expect(importedRow.locator('[data-testid^="project-template-active-"]')).toBeVisible();
    const originalRow = page
      .locator('[data-testid^="project-template-row-"]')
      .filter({hasNotText: renamed.name})
      .first();
    await originalRow.locator('[data-testid^="project-template-switch-"]').click();
    await expect(page.getByTestId('import-template-dialog')).toBeHidden({timeout: 30_000});
    await expect(page.getByText(`Imported section ${stamp}`)).toHaveCount(0, {timeout: 60_000});

    await page.getByTestId('template-config-open-import').first().click();
    await page.getByTestId('import-template-tab-project').click();
    await importedRow.locator('[data-testid^="project-template-delete-"]').click();
    await page.getByTestId('project-template-delete-confirm').click();
    await expect(importedRow).toHaveCount(0, {timeout: 30_000});
  });
});
