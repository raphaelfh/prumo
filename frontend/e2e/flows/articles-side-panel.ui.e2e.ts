import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
  "E2E_SUPABASE_URL",
  "E2E_SUPABASE_SERVICE_ROLE_KEY",
];

/**
 * A minimal, structurally-valid single-page PDF (correct xref offsets), just
 * large enough for pdf.js to parse and render a page — the fixture article
 * has a `article_files` row pointing at this storage key, but the shared
 * E2E fixture provisioner never uploads the underlying bytes (no prior flow
 * needed a real, renderable PDF). Uploaded idempotently below.
 */
function minimalPdfBytes(): Uint8Array<ArrayBuffer> {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>\nendobj\n",
  ];
  const header = "%PDF-1.4\n";
  let body = header;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefOffset = Buffer.byteLength(body);
  const n = objects.length + 1;
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body + xref + trailer);
}

/** Idempotently ensure the fixture article's MAIN file has real PDF bytes behind it. */
async function ensureArticlePdfBytes(): Promise<void> {
  const env = loadE2EEnv();
  const base = env.supabaseUrl!;
  const key = env.supabaseServiceRoleKey!;
  const objectPath = `e2e-fixtures/${env.articleId}.pdf`;

  const existing = await fetch(`${base}/storage/v1/object/list/articles`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "e2e-fixtures/", search: `${env.articleId}.pdf` }),
  });
  const found = existing.ok ? ((await existing.json()) as Array<{ name: string }>) : [];
  if (found.some((f) => f.name === `${env.articleId}.pdf`)) return;

  const uploadRes = await fetch(`${base}/storage/v1/object/articles/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/pdf",
    },
    body: minimalPdfBytes(),
  });
  if (!uploadRes.ok) {
    throw new Error(`ensureArticlePdfBytes upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("Articles side panel — dock and document view", () => {
  test("docks the article panel and switches to the document view", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await ensureArticlePdfBytes();
    await loginViaUi(page);

    const projectId = env.projectId!;
    await page.goto(`/projects/${projectId}?tab=articles`);

    // The panel starts collapsed: the table owns the full width.
    await expect(page.getByTestId("articles-shell-panel")).toHaveCount(0);

    // Target the fixture article by name rather than row position: the
    // shared fixture project holds several articles (QA suites add their
    // own), and only the "E2E Fixture Article" row has real PDF bytes
    // behind it (via ensureArticlePdfBytes above). The row's title cell is
    // the click target — ArticlesList wires onArticleClick there, not on
    // the whole `<tr>`; other cells, like the checkbox, stop propagation.
    const fixtureRow = page.getByRole("row", { name: /E2E Fixture Article/ });
    await fixtureRow.getByRole("cell", { name: "E2E Fixture Article", exact: true }).click();

    // Docked, NOT an overlay: the table is still visible beside it.
    await expect(page.getByTestId("articles-shell-panel")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    await page.getByRole("button", { name: "Document" }).click();
    await expect(page).toHaveURL(/articleView=document/);
    await expect(page.locator("canvas").first()).toBeVisible();
  });
});
