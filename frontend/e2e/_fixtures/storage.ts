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
