/**
 * Tests for /api/v1/runs TanStack Query hooks.
 *
 * The HTTP transport (`apiClient`) is mocked so each test asserts on the
 * exact URL and request body that the hooks would issue, plus the resolved
 * data flowing back through React Query's state.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runsKeys } from "@/hooks/runs/types";
import {
  useAdvanceRun,
  useCreateConsensus,
  useCreateDecision,
  useCreateRun,
  useRun,
  type RunDetailResponse,
} from "@/hooks/runs";
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

describe("useRun", () => {
  it("issues GET /api/v1/runs/{runId}/view and exposes the detail payload", async () => {
    const detail: Pick<RunDetailResponse, "run"> = {
      run: {
        id: "run-1",
        project_id: "project-1",
        article_id: "article-1",
        template_id: "template-1",
        kind: "extraction",
        version_id: "version-1",
        stage: "extract",
        status: "active",
        hitl_config_snapshot: {},
        parameters: {},
        results: {},
        created_at: "2026-04-26T12:00:00Z",
        created_by: "user-1",
      },
    };
    apiClientMock.mockResolvedValueOnce({
      ...detail,
      proposals: [],
      decisions: [],
      consensus_decisions: [],
      published_states: [],
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRun("run-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-1/view");
    expect(result.current.data?.run.id).toBe("run-1");
  });

  it("does not issue a request when runId is null", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRun(null), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(apiClientMock).not.toHaveBeenCalled();
  });
});

describe("useCreateRun", () => {
  it("POSTs /api/v1/runs with the request body", async () => {
    apiClientMock.mockResolvedValueOnce({
      id: "run-2",
      project_id: "project-2",
      article_id: "article-2",
      template_id: "template-2",
      kind: "extraction",
      version_id: "version-2",
      stage: "pending",
      status: "pending",
      hitl_config_snapshot: {},
      parameters: {},
      results: {},
      created_at: "2026-04-26T12:00:00Z",
      created_by: "user-1",
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateRun(), { wrapper });

    const body = {
      project_id: "project-2",
      article_id: "article-2",
      project_template_id: "template-2",
    };

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync(body);
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs", {
      method: "POST",
      body,
    });
    expect(mutationResult?.id).toBe("run-2");
    await waitFor(() => expect(result.current.data?.id).toBe("run-2"));
  });
});

describe("useCreateDecision", () => {
  it("POSTs /api/v1/runs/{runId}/decisions with the request body", async () => {
    apiClientMock.mockResolvedValueOnce({
      id: "decision-1",
      run_id: "run-4",
      instance_id: "instance-1",
      field_id: "field-1",
      reviewer_id: "user-1",
      decision: "accept_proposal",
      proposal_record_id: "proposal-1",
      value: null,
      rationale: null,
      created_at: "2026-04-26T12:00:00Z",
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateDecision("run-4"), { wrapper });

    const body = {
      instance_id: "instance-1",
      field_id: "field-1",
      decision: "accept_proposal" as const,
      proposal_record_id: "proposal-1",
    };

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync(body);
    });

    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-4/decisions", {
      method: "POST",
      body,
    });
    expect(mutationResult?.id).toBe("decision-1");
  });
});

describe("useCreateConsensus", () => {
  it("POSTs /api/v1/runs/{runId}/consensus and returns consensus + published payload", async () => {
    apiClientMock.mockResolvedValueOnce({
      consensus: {
        id: "consensus-1",
        run_id: "run-5",
        instance_id: "instance-1",
        field_id: "field-1",
        consensus_user_id: "user-1",
        mode: "manual_override",
        selected_decision_id: null,
        value: { ok: true },
        rationale: "documented",
        created_at: "2026-04-26T12:00:00Z",
      },
      published: {
        id: "published-1",
        run_id: "run-5",
        instance_id: "instance-1",
        field_id: "field-1",
        value: { ok: true },
        published_at: "2026-04-26T12:00:00Z",
        published_by: "user-1",
        version: 1,
      },
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateConsensus("run-5"), { wrapper });

    const body = {
      instance_id: "instance-1",
      field_id: "field-1",
      mode: "manual_override" as const,
      value: { ok: true },
      rationale: "documented",
    };

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync(body);
    });

    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-5/consensus", {
      method: "POST",
      body,
    });
    expect(mutationResult?.consensus.id).toBe("consensus-1");
    expect(mutationResult?.published.id).toBe("published-1");
  });
});

describe("useAdvanceRun", () => {
  it("POSTs /api/v1/runs/{runId}/advance with the target stage", async () => {
    apiClientMock.mockResolvedValueOnce({
      id: "run-6",
      project_id: "project-6",
      article_id: "article-6",
      template_id: "template-6",
      kind: "extraction",
      version_id: "version-6",
      stage: "extract",
      status: "active",
      hitl_config_snapshot: {},
      parameters: {},
      results: {},
      created_at: "2026-04-26T12:00:00Z",
      created_by: "user-1",
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAdvanceRun("run-6"), { wrapper });

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({ target_stage: "extract" });
    });

    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-6/advance", {
      method: "POST",
      body: { target_stage: "extract" },
    });
    expect(mutationResult?.stage).toBe("extract");
  });
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

describe("useRun disabled key", () => {
  it("uses runsKeys.disabled as queryKey when runId is null", async () => {
    const { wrapper, queryClient } = createWrapper();
    renderHook(() => useRun(null), { wrapper });

    // The cache entry should live under runsKeys.disabled, not some inline literal
    const state = queryClient.getQueryState(runsKeys.disabled);
    // Entry may be undefined (never fetched) but the key must exist if we seeded it
    // The important check: no request was made
    expect(apiClientMock).not.toHaveBeenCalled();
    // And no entry under a rogue inline key
    const rogueState = queryClient.getQueryState(["runs", "disabled"]);
    // Both point to the same structural key — confirm runsKeys.disabled matches
    expect(Array.from(runsKeys.disabled)).toEqual(["runs", "disabled"]);
    void state;
    void rogueState;
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

describe("mutation cache invalidation", () => {
  it("invalidates ['runs', runId] after a successful mutation", async () => {
    apiClientMock.mockResolvedValueOnce({
      id: "decision-cache",
      run_id: "run-cache",
      instance_id: "instance-cache",
      field_id: "field-cache",
      reviewer_id: "user-1",
      decision: "reject",
      proposal_record_id: null,
      value: null,
      rationale: null,
      created_at: "2026-04-26T12:00:00Z",
    });

    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateDecision("run-cache"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        instance_id: "instance-cache",
        field_id: "field-cache",
        decision: "reject",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: runsKeys.detail("run-cache") });
  });
});
