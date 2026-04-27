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
