/**
 * The run lifecycle both screens share, parametrised by kind (ADR-0018: QA
 * mirrors extraction). The transport (`apiClient`) is the only stub: each test
 * asserts the request a command issues, the order it flushes autosave in, the
 * cache it invalidates, and what the reviewer is told.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const expected = vi.hoisted(() => ({ count: 1 }));

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/copy", () => ({ t: (_n: string, k: string) => k }));
vi.mock("@/services/hitlConfigService", () => ({ setManagerReviewVisibility: vi.fn() }));
// The role-derived denominator reaches the supabase client (project members).
vi.mock("@/hooks/runs/useExpectedReviewerCount", () => ({
  useExpectedReviewerCount: () => expected.count,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { toast } from "sonner";
import { apiClient } from "@/integrations/api";
import { setManagerReviewVisibility } from "@/services/hitlConfigService";
import {
  useRunLifecycleScreen,
  useRunView,
  type UseRunLifecycleScreenArgs,
} from "@/hooks/runs/useRunLifecycleScreen";
import { runsKeys, type RunViewResponse } from "@/hooks/runs/types";
import type { RunScreenKind } from "@/lib/runs/runScreenKind";
import {
  ARBITRATOR,
  BLIND_PERMISSIONS,
  makeConsensusDecision,
  makeDecision,
  makeRunView,
} from "./helpers/runScreenFixtures";

const api = vi.mocked(apiClient);
const order: string[] = [];

function routeApi(failing: Record<string, Error> = {}) {
  api.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
    order.push(url);
    const action = url.split("/").pop() ?? "";
    if (failing[action]) throw failing[action];
    if (action === "reviewers") return { reviewers: [] };
    if (action === "reopen") return { id: "run-2" };
    if (action === "view") return makeRunView();
    return init?.body ?? {};
  });
}

interface Options {
  view?: RunViewResponse;
  permissions?: typeof BLIND_PERMISSIONS;
  saveNow?: () => Promise<unknown>;
  finalizedRunId?: string | null;
  formProgress?: { isComplete: boolean; completed: number; total: number };
  requiredCoords?: string[];
}

function renderLifecycle(kind: RunScreenKind, opts: Options = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const spies = {
    goToNextArticle: vi.fn(),
    refetchSession: vi.fn(async () => undefined),
    refreshReaders: vi.fn(async () => undefined),
    saveNow: vi.fn(
      opts.saveNow ??
        (async () => {
          order.push("flush");
        }),
    ),
  };
  const view = "view" in opts ? opts.view : makeRunView();
  const kindTerms =
    kind === "extraction"
      ? { kind, formProgress: opts.formProgress ?? { isComplete: true, completed: 1, total: 1 } }
      : { kind };
  const args = {
    ...kindTerms,
    projectId: "p1",
    runId: view ? view.run.id : null,
    runDetail: view,
    permissions: opts.permissions ?? BLIND_PERMISSIONS,
    currentUserId: "reviewer-1",
    requiredCoords: opts.requiredCoords ?? [],
    finalizedRunId: opts.finalizedRunId,
    ...spies,
  } as UseRunLifecycleScreenArgs;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useRunLifecycleScreen(args), { wrapper });
  return { result, invalidate, ...spies };
}

const posted = (action: string) =>
  api.mock.calls.find(([url]) => url === `/api/v1/runs/run-1/${action}`);

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  expected.count = 1;
  routeApi();
});

describe("useRunView", () => {
  it("GETs /api/v1/runs/{runId}/view under the run's detail key", async () => {
    api.mockResolvedValueOnce(makeRunView());
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRunView("run-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api).toHaveBeenCalledWith("/api/v1/runs/run-1/view");
    expect(queryClient.getQueryData(runsKeys.detail("run-1"))).toEqual(result.current.data);
  });

  it("issues no request without a run", () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRunView(null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });
});

describe.each(["extraction", "qa"] as const)("useRunLifecycleScreen (%s)", (kind) => {
  describe("Mark ready", () => {
    it("flushes autosave, POSTs ready, re-reads the run and its reviewers, then opens the next article", async () => {
      const { result, invalidate, goToNextArticle } = renderLifecycle(kind);
      await act(() => result.current.transition!.onAdvance());

      expect(order.indexOf("flush")).toBeLessThan(order.indexOf("/api/v1/runs/run-1/ready"));
      expect(posted("ready")?.[1]).toEqual({ method: "POST", body: { ready: true } });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: runsKeys.detail("run-1"), exact: true });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: runsKeys.reviewers("run-1") });
      expect(goToNextArticle).toHaveBeenCalledOnce();
      // QA confirms the advisory flag; extraction lets the next article say it.
      if (kind === "qa") expect(toast.success).toHaveBeenCalledWith("markReadySuccess");
      else expect(toast.success).not.toHaveBeenCalled();
    });

    it("sends nothing when the autosave flush fails", async () => {
      const { result, goToNextArticle } = renderLifecycle(kind, {
        saveNow: () => Promise.reject(new Error("offline")),
      });
      await act(() => result.current.transition!.onAdvance());
      expect(posted("ready")).toBeUndefined();
      expect(goToNextArticle).not.toHaveBeenCalled();
    });

    it("toasts a refusal and stays on the article", async () => {
      routeApi({ ready: new Error("Run is not in extract") });
      const { result, goToNextArticle } = renderLifecycle(kind);
      await act(() => result.current.transition!.onAdvance());
      expect(toast.error).toHaveBeenCalledWith("Run is not in extract");
      expect(goToNextArticle).not.toHaveBeenCalled();
    });
  });

  it("Start consensus flushes autosave, advances to consensus and re-reads the run", async () => {
    const { result, invalidate } = renderLifecycle(kind, { permissions: ARBITRATOR });
    expect(result.current.transition?.to).toBe("consensus");
    await act(() => result.current.transition!.onAdvance());
    expect(order.indexOf("flush")).toBeLessThan(order.indexOf("/api/v1/runs/run-1/advance"));
    expect(posted("advance")?.[1]).toEqual({ method: "POST", body: { target_stage: "consensus" } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: runsKeys.detail("run-1"), exact: true });
  });

  describe("in consensus (arbitrator)", () => {
    const consensusView = () =>
      makeRunView({
        run: { stage: "consensus" },
        decisions: [makeDecision({ id: "dec-a", reviewer_id: "peer-a" })],
        peers_revealed: true,
      });

    it("Approve & finalize publishes, re-reads the run and the screen's readers, then opens the next article", async () => {
      const { result, invalidate, refreshReaders, goToNextArticle } = renderLifecycle(kind, {
        view: consensusView(),
        permissions: ARBITRATOR,
      });
      expect(result.current.transition?.gate.ok).toBe(true);
      await act(() => result.current.transition!.onAdvance());
      expect(posted("approve-finalize")?.[1]).toEqual({ method: "POST" });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: runsKeys.detail("run-1"), exact: true });
      expect(refreshReaders).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        kind === "qa" ? "finalizationSuccess" : "extractionScreenFinalizeSuccess",
      );
      expect(goToNextArticle).toHaveBeenCalledOnce();
    });

    it("a refused Approve & finalize toasts the gate and stays", async () => {
      routeApi({ "approve-finalize": new Error("Unresolved divergence") });
      const { result, goToNextArticle } = renderLifecycle(kind, {
        view: consensusView(),
        permissions: ARBITRATOR,
      });
      await act(() => result.current.transition!.onAdvance());
      expect(toast.error).toHaveBeenCalledWith("Unresolved divergence");
      expect(goToNextArticle).not.toHaveBeenCalled();
    });

    it("resolves a coord by adopting a decision or overriding it, then re-reads the run", async () => {
      const { result, invalidate } = renderLifecycle(kind, {
        view: consensusView(),
        permissions: ARBITRATOR,
      });
      await act(() =>
        result.current.consensus.onSelectExisting({ instanceId: "i1", fieldId: "f1", decisionId: "dec-a" }),
      );
      expect(posted("consensus")?.[1]).toEqual({
        method: "POST",
        body: { instance_id: "i1", field_id: "f1", mode: "select_existing", selected_decision_id: "dec-a" },
      });
      await act(() =>
        result.current.consensus.onManualOverride({ instanceId: "i1", fieldId: "f1", value: "Maybe", rationale: "why" }),
      );
      expect(api.mock.calls.filter(([url]) => url.endsWith("/consensus")).at(-1)?.[1]).toEqual({
        method: "POST",
        body: {
          instance_id: "i1",
          field_id: "f1",
          mode: "manual_override",
          value: { value: "Maybe" },
          rationale: "why",
        },
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: runsKeys.detail("run-1"), exact: true });
    });

    it("a refused resolution rejects, so the override editor stays open", async () => {
      routeApi({ consensus: new Error("Forbidden") });
      const { result } = renderLifecycle(kind, { view: consensusView(), permissions: ARBITRATOR });
      await expect(
        result.current.consensus.onSelectExisting({ instanceId: "i1", fieldId: "f1", decisionId: "dec-a" }),
      ).rejects.toThrow("Forbidden");
    });

    it("Reopen to extract sends the same run back, closes the confirm and re-reads", async () => {
      const { result, refreshReaders } = renderLifecycle(kind, {
        view: consensusView(),
        permissions: ARBITRATOR,
      });
      expect(result.current.reopen.canReopenToExtract).toBe(true);
      act(() => result.current.reopen.setConfirmOpen(true));
      act(() => result.current.reopen.reopenToExtract());
      await waitFor(() => expect(result.current.reopen.confirmOpen).toBe(false));
      expect(posted("reopen-extraction")?.[1]).toEqual({ method: "POST" });
      expect(refreshReaders).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        kind === "qa" ? "reopenAssessmentToast" : "reopenExtractionToast",
      );
    });

    it("offers no compare toggle: the resolve table is the only compare surface", () => {
      const { result } = renderLifecycle(kind, { view: consensusView(), permissions: ARBITRATOR });
      expect(result.current.compare.available).toBe(false);
      expect(result.current.compare.jumpToDivergence).toBeUndefined();
    });
  });

  it("Reopen for revision forks a child of the finalized run and re-resolves the session", async () => {
    const { result, invalidate, refetchSession } = renderLifecycle(kind, {
      view: makeRunView({ run: { stage: "finalized" } }),
    });
    expect(result.current.reopen.canReopen).toBe(true);
    expect(result.current.transition).toBeNull();
    await act(() => result.current.reopen.reopenRevision());
    expect(posted("reopen")?.[1]).toEqual({ method: "POST" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: runsKeys.detail("run-1"), exact: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: runsKeys.detail("run-2"), exact: true });
    expect(refetchSession).toHaveBeenCalledOnce();
    expect(result.current.reopen.reopening).toBe(false);
  });

  describe("reveal (ADR-0012)", () => {
    const blindManager: typeof BLIND_PERMISSIONS = { ...BLIND_PERMISSIONS, userRole: "manager" };

    it("is offered to a blind manager during extract only", () => {
      expect(renderLifecycle(kind, { permissions: blindManager }).result.current.reveal.canReveal).toBe(true);
      expect(renderLifecycle(kind).result.current.reveal.canReveal).toBe(false);
      expect(
        renderLifecycle(kind, {
          permissions: blindManager,
          view: makeRunView({ run: { stage: "consensus" } }),
        }).result.current.reveal.canReveal,
      ).toBe(false);
    });

    it("persists the kind's reveal, then refreshes permissions", async () => {
      vi.mocked(setManagerReviewVisibility).mockResolvedValue({} as never);
      const permissions = { ...blindManager, refresh: vi.fn(async () => undefined) };
      const { result } = renderLifecycle(kind, { permissions });
      result.current.reveal.onReveal();
      await waitFor(() => expect(permissions.refresh).toHaveBeenCalledOnce());
      expect(setManagerReviewVisibility).toHaveBeenCalledWith(
        "p1",
        kind === "qa" ? "quality_assessment" : "extraction",
        true,
      );
    });

    it("re-reads the blinded run view, not only the permissions", async () => {
      // The reveal flips the setting the run view's server-side blind filter
      // reads, so the cached view still hides peer decisions until it is
      // invalidated — permissions alone leave compare unavailable.
      vi.mocked(setManagerReviewVisibility).mockResolvedValue({} as never);
      const permissions = { ...blindManager, refresh: vi.fn(async () => undefined) };
      const { result, invalidate, refreshReaders } = renderLifecycle(kind, { permissions });
      result.current.reveal.onReveal();
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: runsKeys.detail("run-1"),
          exact: true,
        }),
      );
      expect(refreshReaders).toHaveBeenCalled();
    });

    it("toasts a failed reveal", async () => {
      vi.mocked(setManagerReviewVisibility).mockRejectedValue(new Error("Network error"));
      const { result } = renderLifecycle(kind, { permissions: blindManager });
      result.current.reveal.onReveal();
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Network error"));
    });
  });

  it("offers compare when the caller may see peers and peers exist; the jump opens it", () => {
    const view = makeRunView({ decisions: [makeDecision({ id: "dec-a", reviewer_id: "peer-a" })] });
    expect(renderLifecycle(kind, { view }).result.current.compare.available).toBe(false);
    const { result } = renderLifecycle(kind, { view, permissions: ARBITRATOR });
    expect(result.current.compare.available).toBe(true);
    expect(result.current.compare.active).toBe(false);
    act(() => result.current.compare.jumpToDivergence!());
    expect(result.current.compare.active).toBe(true);
  });
});

describe("useRunLifecycleScreen — the kind-specific terms", () => {
  it("extraction: an incomplete form blocks Mark ready and guides instead", () => {
    const { result } = renderLifecycle("extraction", {
      formProgress: { isComplete: false, completed: 1, total: 3 },
    });
    expect(result.current.transition?.gate).toMatchObject({ ok: false, remaining: 2 });
    result.current.transition!.onAdvance();
    expect(toast.info).toHaveBeenCalledWith("runHeaderGateBlocked");
    expect(posted("ready")).toBeUndefined();
  });

  it("extraction: finalize waits on run-level required fields", () => {
    const view = makeRunView({ run: { stage: "consensus" } });
    const { result } = renderLifecycle("extraction", {
      view,
      permissions: ARBITRATOR,
      requiredCoords: ["i1_f1"],
    });
    expect(result.current.transition?.gate.ok).toBe(false);
  });

  it("extraction: a declined soft-warn confirm sends nothing", async () => {
    expected.count = 3; // two reviewers missing
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderLifecycle("extraction", {
      view: makeRunView({ run: { stage: "consensus" } }),
      permissions: ARBITRATOR,
    });
    await act(() => result.current.transition!.onAdvance());
    expect(confirm).toHaveBeenCalledOnce();
    expect(posted("approve-finalize")).toBeUndefined();
    confirm.mockRestore();
  });

  it("qa: finalize is refused when nothing was recorded, naming the way out", () => {
    const { result } = renderLifecycle("qa", {
      view: makeRunView({ run: { stage: "consensus" } }),
      permissions: ARBITRATOR,
    });
    expect(result.current.transition?.gate).toMatchObject({
      ok: false,
      reason: "runHeaderApproveNothingRecorded",
    });
    result.current.transition!.onAdvance();
    expect(toast.error).toHaveBeenCalledWith("runHeaderApproveNothingRecorded");
  });

  it("qa: a resolved coord counts as recorded", () => {
    const { result } = renderLifecycle("qa", {
      view: makeRunView({
        run: { stage: "consensus" },
        consensus_decisions: [makeConsensusDecision()],
      }),
      permissions: ARBITRATOR,
    });
    expect(result.current.transition?.gate.ok).toBe(true);
  });

  it("extraction alone opens compare on the run-scoped auto-reveal", () => {
    const view = makeRunView({
      decisions: [makeDecision({ id: "dec-a", reviewer_id: "peer-a" })],
      peers_revealed: true,
    });
    expect(renderLifecycle("extraction", { view }).result.current.compare.available).toBe(true);
    expect(renderLifecycle("qa", { view }).result.current.compare.available).toBe(false);
  });

  it("extraction alone shows the N/M ready hint during extract", () => {
    const view = makeRunView({ ready_count: 1 });
    expect(renderLifecycle("extraction", { view }).result.current.reviewers.header).toMatchObject({
      ready: 1,
      readyTotal: 1,
    });
    expect(renderLifecycle("qa", { view }).result.current.reviewers.header).not.toHaveProperty("ready");
  });

  it("extraction: a separately-found finalized run is the reopen target when no run is open", async () => {
    const { result } = renderLifecycle("extraction", { view: undefined, finalizedRunId: "run-0" });
    expect(result.current.reopen.canReopen).toBe(true);
    await act(() => result.current.reopen.reopenRevision());
    expect(api).toHaveBeenCalledWith("/api/v1/runs/run-0/reopen", { method: "POST" });
  });
});
