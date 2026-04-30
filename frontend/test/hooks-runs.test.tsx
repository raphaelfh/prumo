/**
 * Tests for /api/v1/runs TanStack Query hooks.
 *
 * The HTTP transport (`apiClient`) is mocked so each test asserts on the
 * exact URL and request body that the hooks would issue, plus the resolved
 * data flowing back through React Query's state.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAdvanceRun,
  useCreateConsensus,
  useCreateDecision,
  useCreateProposal,
  useCreateRun,
  useRun,
  type RunDetailResponse,
} from "@/hooks/runs";

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from "@/integrations/api";

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

function createWrapper(): {
  wrapper: (props: { children: ReactNode }) => JSX.Element;
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
  it("issues GET /api/v1/runs/{runId} and exposes the detail payload", async () => {
    const detail: Pick<RunDetailResponse, "run"> = {
      run: {
        id: "run-1",
        project_id: "project-1",
        article_id: "article-1",
        template_id: "template-1",
        kind: "extraction",
        version_id: "version-1",
        stage: "proposal",
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
    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-1");
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

describe("useCreateProposal", () => {
  it("POSTs /api/v1/runs/{runId}/proposals with the request body", async () => {
    apiClientMock.mockResolvedValueOnce({
      id: "proposal-1",
      run_id: "run-3",
      instance_id: "instance-1",
      field_id: "field-1",
      source: "ai",
      source_user_id: null,
      proposed_value: { value: "x" },
      confidence_score: 0.9,
      rationale: null,
      created_at: "2026-04-26T12:00:00Z",
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateProposal("run-3"), { wrapper });

    const body = {
      instance_id: "instance-1",
      field_id: "field-1",
      source: "ai" as const,
      proposed_value: { value: "x" },
    };

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync(body);
    });

    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-3/proposals", {
      method: "POST",
      body,
    });
    expect(mutationResult?.id).toBe("proposal-1");
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
      stage: "review",
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
      mutationResult = await result.current.mutateAsync({ target_stage: "review" });
    });

    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-6/advance", {
      method: "POST",
      body: { target_stage: "review" },
    });
    expect(mutationResult?.stage).toBe("review");
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

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["runs", "run-cache"] });
  });
});
