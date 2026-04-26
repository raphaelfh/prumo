import { expect } from "@playwright/test";

export async function uploadToPresignedUrl(url: string, body: string | Buffer, mimeType: string): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
    body,
  });
  expect(response.ok).toBeTruthy();
}

export async function listStoragePrefix(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  prefix: string;
}): Promise<Array<{ name: string }>> {
  const response = await fetch(`${input.supabaseUrl}/storage/v1/object/list/${input.bucket}`, {
    method: "POST",
    headers: {
      apikey: input.serviceRoleKey,
      Authorization: `Bearer ${input.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix: input.prefix,
      limit: 100,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to list storage objects: ${response.status} ${body}`);
  }

  return (await response.json()) as Array<{ name: string }>;
}
