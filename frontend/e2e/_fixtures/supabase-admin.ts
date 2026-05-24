import { loadE2EEnv } from "./env";

type AdminInit = { url: string; key: string };

function admin(): AdminInit {
  const env = loadE2EEnv();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      "E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY are required for admin operations."
    );
  }
  return { url: env.supabaseUrl, key: env.supabaseServiceRoleKey };
}

function adminHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function adminInsert<T extends Record<string, unknown>>(
  table: string,
  rows: Array<Record<string, unknown>>
): Promise<T[]> {
  const { url, key } = admin();
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: adminHeaders(key),
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`adminInsert(${table}) failed: ${response.status} ${body}`);
  }
  return (await response.json()) as T[];
}

export async function adminSelect<T extends Record<string, unknown>>(
  table: string,
  query: string
): Promise<T[]> {
  const { url, key } = admin();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "GET",
    headers: adminHeaders(key),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`adminSelect(${table}) failed: ${response.status} ${body}`);
  }
  return (await response.json()) as T[];
}

export async function adminDelete(table: string, query: string): Promise<void> {
  const { url, key } = admin();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: adminHeaders(key),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`adminDelete(${table}) failed: ${response.status} ${body}`);
  }
}

export async function adminRpc<T>(
  fn: string,
  payload: Record<string, unknown>
): Promise<T> {
  const { url, key } = admin();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: adminHeaders(key),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`adminRpc(${fn}) failed: ${response.status} ${body}`);
  }
  return (await response.json()) as T;
}

/**
 * Resolve the active extraction template for a project at test runtime.
 * Hardcoding E2E_TEMPLATE_ID in .env is fragile because backend pytest
 * (test_template_clone_extraction.py) reseeds the project's templates,
 * inventing fresh UUIDs every time `make test-backend` runs. Discovering
 * the template through the DB at the moment the test needs it removes
 * that coupling.
 */
export async function resolveActiveExtractionTemplateId(projectId: string): Promise<string> {
  const rows = await adminSelect<{ id: string }>(
    "project_extraction_templates",
    `project_id=eq.${projectId}&kind=eq.extraction&is_active=eq.true&select=id&order=created_at.desc&limit=1`
  );
  if (rows.length === 0) {
    throw new Error(
      `No active extraction template found for project ${projectId}. Seed CHARMS via the Configuration UI or run \`python -m backend.app.seed\`.`
    );
  }
  return rows[0].id;
}

/**
 * Pick a study_section entity in the given template — a stable target for
 * section-level extraction calls. Study sections live at the root of the
 * template (no parent), making them safe to use regardless of model
 * container presence.
 */
export async function resolveStudySectionEntityTypeId(templateId: string): Promise<string> {
  const rows = await adminSelect<{ id: string }>(
    "extraction_entity_types",
    `project_template_id=eq.${templateId}&role=eq.study_section&select=id&order=sort_order&limit=1`
  );
  if (rows.length === 0) {
    throw new Error(
      `No study_section entity found in template ${templateId}. The template structure may be empty or corrupted.`
    );
  }
  return rows[0].id;
}
