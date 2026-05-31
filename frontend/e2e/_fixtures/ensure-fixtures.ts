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
