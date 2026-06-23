// frontend/test/hooks/useReparseArticleFile.test.tsx
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copy", () => ({ t: (_n: string, k: string) => k }));

import { apiClient } from "@/integrations/api";
import { useReparseArticleFile } from "@/hooks/extraction/useReparseArticleFile";

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

describe("useReparseArticleFile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs reparse and invalidates files + textBlocks", async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { wrapper, spy } = wrap();
    const { result } = renderHook(() => useReparseArticleFile("art-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("file-9");
    });

    expect(apiClient).toHaveBeenCalledWith(
      "/api/v1/article-files/file-9/reparse",
      { method: "POST" },
    );
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys.some((k) => k?.includes("files"))).toBe(true);
    expect(keys.some((k) => k?.includes("text-blocks"))).toBe(true);
  });
});
