
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

