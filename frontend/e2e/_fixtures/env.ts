export type E2EEnvConfig = {
  frontendUrl: string;
  apiUrl: string;
  authToken?: string;
  userEmail?: string;
  userPassword?: string;
  projectId?: string;
  articleId?: string;
  templateId?: string;
  entityTypeId?: string;
  schemaId?: string;
  schemaVersionId?: string;
  targetId?: string;
  itemId?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
};

export function loadE2EEnv(): E2EEnvConfig {
  return {
    frontendUrl: process.env.E2E_FRONTEND_URL || "http://127.0.0.1:8080",
    apiUrl: process.env.E2E_API_URL || "http://127.0.0.1:8000",
    authToken: process.env.E2E_AUTH_TOKEN,
    userEmail: process.env.E2E_USER_EMAIL,
    userPassword: process.env.E2E_USER_PASSWORD,
    projectId: process.env.E2E_PROJECT_ID,
    articleId: process.env.E2E_ARTICLE_ID,
    templateId: process.env.E2E_TEMPLATE_ID,
    entityTypeId: process.env.E2E_ENTITY_TYPE_ID,
    schemaId: process.env.E2E_SCHEMA_ID,
    schemaVersionId: process.env.E2E_SCHEMA_VERSION_ID,
    targetId: process.env.E2E_TARGET_ID,
    itemId: process.env.E2E_ITEM_ID,
    supabaseUrl: process.env.E2E_SUPABASE_URL,
    supabaseAnonKey: process.env.E2E_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function missingEnvKeys(keys: string[]): string[] {
  return keys.filter((key) => !process.env[key]);
}

export function createTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
