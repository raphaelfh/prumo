import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { extractSection, state, options } = vi.hoisted(() => ({
  extractSection: vi.fn(),
  state: { loading: false, error: null as {code: string; message: string} | null, uncertainTransport: false },
  options: vi.fn(),
}));

vi.mock("@/hooks/extraction/useSectionExtraction", () => ({
  useSectionExtraction: (args: unknown) => {
    options(args);
    return { extractSection, loading: state.loading, error: state.error?.message ?? null, getSectionState: () => state };
  },
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
  state.error = null;
  state.uncertainTransport = false;
});

describe("SectionAIExtractButton", () => {
  it("subscribes to the full current section coordinate before kickoff", () => {
    render(<SectionAIExtractButton {...baseProps} parentInstanceId="m1" />);
    expect(options).toHaveBeenCalledWith(expect.objectContaining({params: {
      projectId: 'p1', articleId: 'a1', templateId: 't1', entityTypeId: 'et1', runId: 'r1', parentInstanceId: 'm1',
    }}));
  });

  it("offers a classified retry tooltip after failure", () => {
    state.error = {code: 'MISSING_API_KEY', message: 'Missing credentials'};
    render(<SectionAIExtractButton {...baseProps} />);
    const button = screen.getByTestId('section-ai-extract-et1');
    expect(button).toBeEnabled();
    expect(button.getAttribute('aria-label')).toMatch(/Retry extraction/);
    expect(button.getAttribute('aria-label')).toMatch(/Authentication error/i);
  });

  it("explains an uncertain transport retry", () => {
    state.error = {code: 'NETWORK_ERROR', message: 'Lost response'};
    state.uncertainTransport = true;
    render(<SectionAIExtractButton {...baseProps} />);
    expect(screen.getByTestId('section-ai-extract-et1')).toHaveAttribute('aria-label', 'Check this extraction again — the request may already be running.');
  });
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
