/**
 * QualityAssessmentFullScreen — the AI kickoff controls (the header's
 * Extract-with-AI and the per-domain button) follow the project role: hidden
 * while the role is loading, when no membership was found, and for a viewer;
 * shown to a reviewer in the extract stage. Harness copied from
 * QualityAssessmentFullScreen.form.test.tsx.
 */
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "qa-test-reviewer-id" }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "qa-test-reviewer-id" }, session: null, loading: false }),
}));

vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

const memberRole = vi.hoisted(() => ({
  current: { role: "reviewer" as string | null, isManager: false, loading: false },
}));
vi.mock("@/hooks/useProjectMemberRole", () => ({
  useProjectMemberRole: () => memberRole.current,
}));

const membersFixture = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { makeSupabaseClientMock } = await import("./helpers/runScreenFixtures");
  return { supabase: makeSupabaseClientMock({ members: membersFixture, userId: "qa-test-reviewer-id" }) };
});

vi.mock("@prumo/pdf-viewer", async () => {
  const core =
    await vi.importActual<typeof import("@/pdf-viewer/core")>("@/pdf-viewer/core");
  return {
    PrumoPdfViewer: () => <div data-testid="qa-pdf-viewer-stub">PDF</div>,
    articleFileSourceFromStorageKey: (storageKey: string) => ({
      kind: "lazy" as const,
      load: async () => ({ kind: "url" as const, url: `stub://${storageKey}` }),
    }),
    createViewerStore: core.createViewerStore,
    subscribeReaderLocate: core.subscribeReaderLocate,
  };
});

vi.mock("@/integrations/api", async () => {
  const { qaApi } = await import("./helpers/runScreenFixtures");
  return { apiClient: vi.fn(qaApi()) };
});

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";

import { BLIND_PERMISSIONS } from "./helpers/runScreenFixtures";
import { renderQaPage } from "./helpers/runScreenRender";

describe("QualityAssessmentFullScreen — AI kickoff controls follow the project role", () => {
  beforeEach(() => {
    vi.mocked(useComparisonPermissions).mockReturnValue(BLIND_PERMISSIONS);
  });

  afterEach(() => {
    memberRole.current = { role: "reviewer", isManager: false, loading: false };
  });

  it.each([
    ["the role is still loading", { role: null, loading: true }],
    ["a stale role is reloading", { role: "reviewer", loading: true }],
    ["the role lookup found no membership", { role: null, loading: false }],
    ["the member is a viewer", { role: "viewer", loading: false }],
  ])("hides every AI kickoff control while %s", async (_case, state) => {
    memberRole.current = { ...state, isManager: false };
    renderQaPage();

    // The domain is up before asserting absence.
    expect(await screen.findByTestId("qa-domain-participants")).toBeInTheDocument();
    expect(screen.queryByTestId("run-ai-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-ai-extract-et-1")).not.toBeInTheDocument();
  });

  it("shows every AI kickoff control to a reviewer in the extract stage", async () => {
    renderQaPage();

    expect(await screen.findByTestId("section-ai-extract-et-1")).toBeInTheDocument();
    expect(await screen.findByTestId("run-ai-actions")).toBeInTheDocument();
  });
});
