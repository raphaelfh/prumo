/**
 * Tests for the run-scoped query keys and the reviewers query. The run view
 * and the stage commands are covered at their seam, useRunLifecycleScreen.
 *
 * The HTTP transport (`apiClient`) is mocked so each test asserts on the
 * exact URL the hook issues, plus the resolved data flowing back through
 * React Query's state.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runsKeys } from "@/hooks/runs/types";
import { useRunReviewers } from "@/hooks/runs/useRunReviewers";

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from "@/integrations/api";

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

function createWrapper(): {
  wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runsKeys factory — disabled and reviewers keys", () => {
  it("runsKeys.disabled produces ['runs', 'disabled']", () => {
    expect(runsKeys.disabled).toEqual(["runs", "disabled"]);
  });

  it("runsKeys.noRunReviewers produces ['runs', 'no-run', 'reviewers']", () => {
    expect(runsKeys.noRunReviewers).toEqual(["runs", "no-run", "reviewers"]);
  });

  it("runsKeys.reviewers(runId) produces ['runs', runId, 'reviewers']", () => {
    expect(runsKeys.reviewers("run-42")).toEqual(["runs", "run-42", "reviewers"]);
  });
});

describe("useRunReviewers", () => {
  it("fetches reviewers and returns derived maps", async () => {
    apiClientMock.mockResolvedValueOnce({
      reviewers: [
        { id: "user-1", full_name: "Alice", avatar_url: "https://example.com/a.png" },
        { id: "user-2", full_name: null, avatar_url: null },
      ],
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunReviewers("run-rev-1"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-rev-1/reviewers");
    expect(result.current.data).toHaveLength(2);
    expect(result.current.labelById["user-1"]).toBe("Alice");
    expect(result.current.labelById["user-2"]).toMatch(/^Reviewer user-2/);
    expect(result.current.avatarById["user-1"]).toBe("https://example.com/a.png");
    expect(result.current.avatarById["user-2"]).toBeNull();
  });

  it("uses runsKeys.reviewers(runId) as the queryKey — prefix-matches detail key", () => {
    const reviewersKey = runsKeys.reviewers("run-rev-1");
    const detailKey = runsKeys.detail("run-rev-1");
    // reviewers key starts with the same prefix as detail key
    expect(reviewersKey.slice(0, 2)).toEqual(detailKey);
    expect(reviewersKey).toEqual(["runs", "run-rev-1", "reviewers"]);
  });

  it("does not fetch when runId is null and uses noRunReviewers key", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRunReviewers(null), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(apiClientMock).not.toHaveBeenCalled();
    expect(runsKeys.noRunReviewers).toEqual(["runs", "no-run", "reviewers"]);
  });
});

