import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Template list hook — empty list keeps the test focused on the blind toggle.
vi.mock("@/hooks/hitl/useHITLProjectTemplates", () => ({
  useHITLProjectTemplates: () => ({
    templates: [],
    globalTemplates: [],
    loading: false,
    error: null,
    cloneTemplate: vi.fn(),
    setTemplateActive: vi.fn(),
    isTemplateImported: () => false,
  }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "cfg-test-user" }),
}));

vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

// The toggle's write path — not exercised on mount, but mock to be safe.
vi.mock("@/services/hitlConfigService", () => ({
  setManagerReviewVisibility: vi.fn().mockResolvedValue(undefined),
}));

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";
import { QualityAssessmentConfiguration } from "@/components/quality/QualityAssessmentConfiguration";

const mockedPermissions = vi.mocked(useComparisonPermissions);

const BASE = {
  userRole: "reviewer" as const,
  isBlindMode: true,
  canSeeOthers: false,
  canResolveConflicts: false,
  canManageBlindMode: false,
  canExport: false,
  canEditTemplate: false,
  loading: false,
  error: null,
  refresh: vi.fn(),
};

describe("QualityAssessmentConfiguration — manager blind toggle", () => {
  beforeEach(() => {
    mockedPermissions.mockReturnValue(BASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts the quality_assessment visibility toggle, disabled for non-managers", () => {
    render(<QualityAssessmentConfiguration projectId="p1" />);
    expect(screen.getByText(/reviewer visibility/i)).toBeInTheDocument();
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("id", "manager-visibility-quality_assessment");
    expect(sw).toBeDisabled();
    // Setting off → toggle reflects "off".
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("enables the toggle for a manager and reflects the persisted on-value", () => {
    mockedPermissions.mockReturnValue({
      ...BASE,
      userRole: "manager",
      isBlindMode: false,
      canSeeOthers: true,
      canManageBlindMode: true,
    });
    render(<QualityAssessmentConfiguration projectId="p1" />);
    const sw = screen.getByRole("switch");
    expect(sw).toBeEnabled();
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("enables the toggle for a manager with the setting OFF", () => {
    mockedPermissions.mockReturnValue({
      ...BASE,
      userRole: "manager",
      isBlindMode: true,
      canSeeOthers: false,
      canManageBlindMode: true,
    });
    render(<QualityAssessmentConfiguration projectId="p1" />);
    const sw = screen.getByRole("switch");
    expect(sw).toBeEnabled();
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("hides the toggle block while permissions are loading", () => {
    mockedPermissions.mockReturnValue({ ...BASE, loading: true });
    render(<QualityAssessmentConfiguration projectId="p1" />);
    expect(screen.queryByText(/reviewer visibility/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
