/**
 * Supabase Environment Configuration
 *
 * Centralizes Supabase environment variable resolution with support for:
 * - Local dev (VITE_SUPABASE_*)
 * - Vercel (SUPABASE_*)
 * - Next.js (NEXT_PUBLIC_SUPABASE_*)
 */

const normalizeEnv = (value?: string): string => (value || "").trim();

const toLower = (value: string): string => value.toLowerCase();

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, "");

const resolveSupabaseEnv = (): "local" | "production" => {
  const raw = normalizeEnv(import.meta.env.VITE_SUPABASE_ENV);
  return raw && toLower(raw) === "local" ? "local" : "production";
};

export const SUPABASE_ENV: "local" | "production" = resolveSupabaseEnv();
export const IS_LOCAL_SUPABASE: boolean = SUPABASE_ENV === "local";

const resolveSupabaseUrl = (): string => {
  if (IS_LOCAL_SUPABASE) {
    return normalizeEnv(import.meta.env.VITE_SUPABASE_URL);
  }

  return (
    normalizeEnv(import.meta.env.VITE_SUPABASE_URL) ||
    normalizeEnv(import.meta.env.SUPABASE_URL) ||
    normalizeEnv(import.meta.env.NEXT_PUBLIC_SUPABASE_URL)
  );
};

const resolveSupabasePublishableKey = (): string => {
  if (IS_LOCAL_SUPABASE) {
    return (
      normalizeEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
      normalizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)
    );
  }

  return (
    normalizeEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    normalizeEnv(import.meta.env.VITE_SUPABASE_ANON_KEY) ||
    normalizeEnv(import.meta.env.SUPABASE_ANON_KEY) ||
    normalizeEnv(import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
};

export const SUPABASE_URL: string = resolveSupabaseUrl();
export const SUPABASE_PUBLISHABLE_KEY: string = resolveSupabasePublishableKey();

const getStorageKey = (url: string): string => {
  try {
    const host = new URL(url).hostname;
    return `sb-${host.split(".")[0]}-auth-token`;
  } catch {
    return "";
  }
};

export const SUPABASE_STORAGE_KEY: string = getStorageKey(SUPABASE_URL);
export const SUPABASE_EXPECTED_ISSUER: string = SUPABASE_URL
  ? `${stripTrailingSlash(SUPABASE_URL)}/auth/v1`
  : "";

export const isLocalSupabaseUrl = (url: string): boolean =>
  url.includes("127.0.0.1") || url.includes("localhost");
