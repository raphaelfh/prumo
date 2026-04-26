import { randomUUID } from "node:crypto";

import { loadE2EEnv } from "./env";

type AdminUser = {
  id: string;
  email: string;
  password: string;
};

export async function createRlsUserPair(runId: string): Promise<{ userA: AdminUser; userB: AdminUser }> {
  const env = loadE2EEnv();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY are required for RLS user bootstrap.");
  }

  const userA = await createAdminUser(env.supabaseUrl, env.supabaseServiceRoleKey, {
    email: `e2e-a-${runId}@prumo.test`,
    password: `Prumo!${runId.slice(0, 10)}A`,
  });
  const userB = await createAdminUser(env.supabaseUrl, env.supabaseServiceRoleKey, {
    email: `e2e-b-${runId}@prumo.test`,
    password: `Prumo!${runId.slice(0, 10)}B`,
  });

  return { userA, userB };
}

async function createAdminUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  input: { email: string; password: string }
): Promise<AdminUser> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { e2e: true, run_id: randomUUID() },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create admin user: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as { id: string; email: string };
  return { id: payload.id, email: payload.email, password: input.password };
}
