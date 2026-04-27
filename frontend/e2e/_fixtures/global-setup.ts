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

  // Reset the resource registry so we never accidentally inherit IDs from a
  // previous interrupted run.
  clearRegistry();
}
