import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mutable roster read at rpc-call time so each test can vary the members the
// `get_project_members` RPC returns (vi.mock factories are hoisted, so the
// shared state must be too).
const membersFixture = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) =>
      Promise.resolve(
        fn === "get_project_members"
          ? { data: membersFixture.rows, error: null }
          : { data: null, error: null },
      ),
  },
}));

import { useExpectedReviewerCount } from "@/hooks/runs/useExpectedReviewerCount";

function member(userId: string, role: string) {
  return {
    id: `pm-${userId}`,
    user_id: userId,
    role,
    user_email: `${userId}@x.test`,
    user_full_name: userId,
    user_avatar_url: null,
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useExpectedReviewerCount", () => {
  beforeEach(() => {
    membersFixture.rows = [];
  });

  it("counts members with reviewer or manager roles once the roster loads", async () => {
    membersFixture.rows = [
      member("u1", "reviewer"),
      member("u2", "reviewer"),
      member("u3", "manager"),
      member("u4", "viewer"),
      member("u5", "consensus"),
    ];
    const { result } = renderHook(
      () => useExpectedReviewerCount("p1", 1),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current).toBe(3));
  });

  it("never reports fewer expected than actual participants (the 'N of 1' regression)", async () => {
    // The real-world QA bug: 2 reviewers submitted but the roster only has one
    // eligible member left (e.g. a member was removed) — the denominator must
    // floor at the participant count, never show "2 of 1".
    membersFixture.rows = [member("u1", "manager")];
    const { result } = renderHook(
      () => useExpectedReviewerCount("p1", 2),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("falls back to the participant count while no roster is available", () => {
    const { result } = renderHook(
      () => useExpectedReviewerCount(undefined, 2),
      { wrapper: makeWrapper() },
    );
    expect(result.current).toBe(2);
  });
});
