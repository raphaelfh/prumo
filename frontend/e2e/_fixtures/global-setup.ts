import type { FullConfig } from "@playwright/test";

import { loadE2EEnv } from "./env";
import { clearRegistry } from "./registry";

async function waitForHealthcheck(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient startup errors.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for healthcheck: ${url}`);
}

async function resolveSupabaseToken(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string
): Promise<{ accessToken: string | null; userId: string | null }> {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) return { accessToken: null, userId: null };
    const body = (await response.json()) as {
      access_token?: string;
      user?: { id?: string };
    };
    return {
      accessToken: body.access_token ?? null,
      userId: body.user?.id ?? null,
    };
  } catch {
    return { accessToken: null, userId: null };
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const env = loadE2EEnv();
  await waitForHealthcheck(`${env.apiUrl}/health`, 60_000);
  await waitForHealthcheck(env.frontendUrl, 60_000);

  // Auto-resolve the primary E2E_AUTH_TOKEN + E2E_USER_ID from email/password
  // when needed, so API-only tests do not skip and admin seeds have a created_by.
  if (
    (!process.env.E2E_AUTH_TOKEN || !process.env.E2E_USER_ID) &&
    env.userEmail &&
    env.userPassword &&
    env.supabaseUrl &&
    env.supabaseAnonKey
  ) {
    const { accessToken, userId } = await resolveSupabaseToken(
      env.supabaseUrl,
      env.supabaseAnonKey,
      env.userEmail,
      env.userPassword
    );
    if (accessToken && !process.env.E2E_AUTH_TOKEN) {
      process.env.E2E_AUTH_TOKEN = accessToken;
    }
    if (userId && !process.env.E2E_USER_ID) {
      process.env.E2E_USER_ID = userId;
    }
  }

  // Auto-resolve the dedicated rate-limit user token when only email/password
  // are provided, so the cross-cutting burst test can run without the caller
  // pre-fetching tokens manually.
  if (
    !process.env.E2E_RATE_LIMIT_TOKEN &&
    env.rateLimitEmail &&
    env.rateLimitPassword &&
    env.supabaseUrl &&
    env.supabaseAnonKey
  ) {
    const { accessToken } = await resolveSupabaseToken(
      env.supabaseUrl,
      env.supabaseAnonKey,
      env.rateLimitEmail,
      env.rateLimitPassword
    );
    if (accessToken) {
      process.env.E2E_RATE_LIMIT_TOKEN = accessToken;
    }
  }

  // Auto-resolve Reviewer C — the third reviewer used by 3-way consensus tests.
  if (
    !process.env.E2E_REVIEWER_C_TOKEN &&
    env.reviewerCEmail &&
    env.reviewerCPassword &&
    env.supabaseUrl &&
    env.supabaseAnonKey
  ) {
    const { accessToken, userId } = await resolveSupabaseToken(
      env.supabaseUrl,
      env.supabaseAnonKey,
      env.reviewerCEmail,
      env.reviewerCPassword
    );
    if (accessToken) {
      process.env.E2E_REVIEWER_C_TOKEN = accessToken;
    }
    if (userId) {
      process.env.E2E_REVIEWER_C_USER_ID = userId;
    }
  }

  // Reset the resource registry so we never accidentally inherit IDs from a
  // previous interrupted run.
  clearRegistry();

  // Sweep zombie test fixtures from prior runs that crashed before global
  // teardown could clean them. The multi-instance test creates entity types
  // under the shared PROBAST template with predictable name prefixes; without
  // this sweep, every aborted run leaks 3 entity types into the seed and
  // pollutes /hitl/sessions instance maps for subsequent tests.
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    const sweepNames = [
      "field_zoo_*",
      "model_card_many_*",
      "study_summary_one_*",
    ];
    const headers = {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    };
    for (const pattern of sweepNames) {
      try {
        // Resolve the entity-type ids first, then delete dependent instances
        // and fields, then the entity types themselves. The FKs do not
        // cascade.
        const idsRes = await fetch(
          `${env.supabaseUrl}/rest/v1/extraction_entity_types` +
            `?name=like.${encodeURIComponent(pattern)}&select=id`,
          { headers },
        );
        if (!idsRes.ok) continue;
        const rows = (await idsRes.json()) as Array<{ id: string }>;
        if (rows.length === 0) continue;
        const inFilter = rows.map((r) => `"${r.id}"`).join(",");
        const idsClause = `entity_type_id=in.(${inFilter})`;
        await fetch(`${env.supabaseUrl}/rest/v1/extraction_instances?${idsClause}`, {
          method: "DELETE",
          headers,
        });
        await fetch(`${env.supabaseUrl}/rest/v1/extraction_fields?${idsClause}`, {
          method: "DELETE",
          headers,
        });
        await fetch(
          `${env.supabaseUrl}/rest/v1/extraction_entity_types?id=in.(${inFilter})`,
          { method: "DELETE", headers },
        );
      } catch {
        // best-effort: a sweep failure shouldn't block the run
      }
    }
  }
}
