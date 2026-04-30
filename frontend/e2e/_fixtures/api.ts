import { APIRequestContext, expect } from "@playwright/test";

export type ApiEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  trace_id?: string;
};

export function authHeaders(token: string, traceId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Trace-Id": traceId,
    "Content-Type": "application/json",
  };
}

export async function parseEnvelope<T>(response: Response | { json(): Promise<unknown> }): Promise<ApiEnvelope<T>> {
  const body = (await response.json()) as ApiEnvelope<T>;
  return body;
}

export async function expectEnvelopeOk<T>(
  request: APIRequestContext,
  method: "get" | "post" | "patch" | "delete",
  url: string,
  options: {
    token: string;
    traceId: string;
    data?: unknown;
    expectedStatus?: number;
  }
): Promise<ApiEnvelope<T>> {
  const response = await request.fetch(url, {
    method: method.toUpperCase(),
    headers: authHeaders(options.token, options.traceId),
    data: options.data,
  });
  expect(response.status()).toBe(options.expectedStatus ?? 200);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.ok).toBeTruthy();
  expect(body.trace_id).toBeTruthy();
  return body;
}
