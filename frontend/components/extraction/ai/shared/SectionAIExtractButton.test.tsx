import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { extractSection, state } = vi.hoisted(() => ({
  extractSection: vi.fn(),
  state: { loading: false },
}));

vi.mock("@/hooks/extraction/useSectionExtraction", () => ({
  useSectionExtraction: () => ({ extractSection, loading: state.loading, error: null }),
}));

import { SectionAIExtractButton } from "@/components/extraction/ai/shared/SectionAIExtractButton";

const baseProps = {
  projectId: "p1",
  articleId: "a1",
  templateId: "t1",
  entityTypeId: "et1",
  entityLabel: "Participants",
  runId: "r1",
};

afterEach(() => {
  extractSection.mockReset();
  state.loading = false;
});

describe("SectionAIExtractButton", () => {
  it("renders the ✨ button with an accessible label", () => {
    render(<SectionAIExtractButton {...baseProps} />);
    const btn = screen.getByTestId("section-ai-extract-et1");
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute("aria-label", "Extract Participants with AI");
  });

  it("calls extractSection with the section coordinates on click", () => {
    extractSection.mockResolvedValue(undefined);
    render(<SectionAIExtractButton {...baseProps} parentInstanceId="m1" />);
    fireEvent.click(screen.getByTestId("section-ai-extract-et1"));
    expect(extractSection).toHaveBeenCalledWith({
      projectId: "p1",
      articleId: "a1",
      templateId: "t1",
      entityTypeId: "et1",
      parentInstanceId: "m1",
      runId: "r1",
    });
  });

  it("is disabled (and does not extract) when disabled=true", () => {
    render(<SectionAIExtractButton {...baseProps} disabled />);
    const btn = screen.getByTestId("section-ai-extract-et1");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(extractSection).not.toHaveBeenCalled();
  });

  it("shows the spinner and disables the button while loading", () => {
    state.loading = true;
    render(<SectionAIExtractButton {...baseProps} />);
    const btn = screen.getByTestId("section-ai-extract-et1");
    expect(btn).toBeDisabled();
    expect(btn.querySelector(".animate-spin")).toBeTruthy();
  });
});
