import type { FullConfig } from "@playwright/test";

import { loadE2EEnv } from "./env";
import { clearRegistry, listResources } from "./registry";

type DeleteResult = { deleted: number; failed: number };

async function deleteFromTable(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  ids: string[]
): Promise<DeleteResult> {
  if (ids.length === 0) {
    return { deleted: 0, failed: 0 };
  }
  const inFilter = ids.map((id) => `"${id}"`).join(",");
  const url = `${supabaseUrl}/rest/v1/${table}?id=in.(${inFilter})`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
  });
  if (!response.ok) {
    return { deleted: 0, failed: ids.length };
  }
  return { deleted: ids.length, failed: 0 };
}

async function deleteAuthUser(
  supabaseUrl: string,
  serviceKey: string,
  userId: string
): Promise<boolean> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  return response.ok;
}

async function deleteStorageObject(
  supabaseUrl: string,
  serviceKey: string,
  bucket: string,
  storagePath: string
): Promise<boolean> {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`, {
    method: "DELETE",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  return response.ok;
}

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const env = loadE2EEnv();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    // Without service-role we cannot clean up; leave the registry intact so a
    // human can inspect.
    return;
  }

  const entries = listResources();
  if (entries.length === 0) {
    return;
  }

  const grouped: Record<string, string[]> = {
    extraction_instances: [],
    extraction_fields: [],
    extraction_entity_types: [],
  };
  const authUserIds: string[] = [];
  const storageObjects: Array<{ bucket: string; path: string }> = [];

  for (const entry of entries) {
    switch (entry.kind) {
      case "extraction_instance":
        grouped.extraction_instances.push(entry.id);
        break;
      case "extraction_field":
        grouped.extraction_fields.push(entry.id);
        break;
      case "extraction_entity_type":
        grouped.extraction_entity_types.push(entry.id);
        break;
      case "auth_user":
        authUserIds.push(entry.id);
        break;
      case "storage_object":
        if (entry.bucket) {
          storageObjects.push({ bucket: entry.bucket, path: entry.id });
        }
        break;
    }
  }

  const summary: Record<string, DeleteResult> = {};

  // Order matters: delete dependents first.
  summary.extraction_instances = await deleteFromTable(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    "extraction_instances",
    grouped.extraction_instances
  );
  summary.extraction_fields = await deleteFromTable(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    "extraction_fields",
    grouped.extraction_fields
  );
  summary.extraction_entity_types = await deleteFromTable(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    "extraction_entity_types",
    grouped.extraction_entity_types
  );

  let storageDeleted = 0;
  for (const obj of storageObjects) {
    const ok = await deleteStorageObject(
      env.supabaseUrl,
      env.supabaseServiceRoleKey,
      obj.bucket,
      obj.path
    );
    if (ok) storageDeleted += 1;
  }

  let authDeleted = 0;
  for (const userId of authUserIds) {
    const ok = await deleteAuthUser(env.supabaseUrl, env.supabaseServiceRoleKey, userId);
    if (ok) authDeleted += 1;
  }

  console.warn(
    "[e2e] global teardown summary:",
    JSON.stringify(
      {
        ...summary,
        storage_objects_deleted: storageDeleted,
        auth_users_deleted: authDeleted,
      },
      null,
      2
    )
  );

  clearRegistry();
}
