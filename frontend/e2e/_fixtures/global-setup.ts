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
): Promise<string | null> {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const env = loadE2EEnv();
  await waitForHealthcheck(`${env.apiUrl}/health`, 60_000);
  await waitForHealthcheck(env.frontendUrl, 60_000);

  // Auto-resolve the primary E2E_AUTH_TOKEN from email/password if needed, so
  // API-only tests do not skip when the caller only supplies credentials.
  if (
    !process.env.E2E_AUTH_TOKEN &&
    env.userEmail &&
    env.userPassword &&
    env.supabaseUrl &&
    env.supabaseAnonKey
  ) {
    const token = await resolveSupabaseToken(
      env.supabaseUrl,
      env.supabaseAnonKey,
      env.userEmail,
      env.userPassword
    );
    if (token) {
      process.env.E2E_AUTH_TOKEN = token;
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
    const token = await resolveSupabaseToken(
      env.supabaseUrl,
      env.supabaseAnonKey,
      env.rateLimitEmail,
      env.rateLimitPassword
    );
    if (token) {
      process.env.E2E_RATE_LIMIT_TOKEN = token;
    }
  }

  // Reset the resource registry so we never accidentally inherit IDs from a
  // previous interrupted run.
  clearRegistry();
}
