import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  OverallJudgmentBanner,
  type DerivedJudgmentView,
} from "@/components/assessment/OverallJudgmentBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qa } from "@/lib/copy/qa";

function renderBanner(judgments: DerivedJudgmentView[]) {
  return render(
    <TooltipProvider>
      <OverallJudgmentBanner judgments={judgments} />
    </TooltipProvider>,
  );
}

describe("OverallJudgmentBanner", () => {
  it("renders nothing when there are no derived judgments", () => {
    const { container } = renderBanner([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one chip per judgment with its value", () => {
    renderBanner([
      { id: "dev_overall_quality", label: "Overall quality (development)", value: "High" },
      { id: "eval_overall_rob", label: "Overall RoB (evaluation)", value: "Low" },
    ]);
    expect(screen.getByTestId("qa-overall-dev_overall_quality")).toHaveTextContent("High");
    expect(screen.getByTestId("qa-overall-eval_overall_rob")).toHaveTextContent("Low");
  });

  it("renders an em dash for an incomplete judgment, never Low", () => {
    renderBanner([{ id: "x", label: "Overall quality", value: null }]);
    const chip = screen.getByTestId("qa-overall-x");
    expect(chip).toHaveTextContent("—");
    expect(chip).not.toHaveTextContent("Low");
  });
});

// (D) The disclosure. A dash with no explanation is what let a reviewer clear a
// domain judgment and then hunt blindly for the cause across ten sections.
describe("OverallJudgmentBanner — calculation disclosure", () => {
  const INCOMPLETE: DerivedJudgmentView[] = [
    {
      id: "dev_overall_quality",
      label: "Overall quality (development)",
      value: null,
      inputs: [
        { label: "Development D1: Participants", value: null },
        { label: "Development D2: Predictors", value: "Unclear" },
      ],
    },
  ];

  it("stays collapsed until asked", () => {
    renderBanner(INCOMPLETE);
    expect(screen.getByTestId("qa-overall-explain-toggle")).toHaveTextContent(
      qa.overallExplainShow,
    );
    // Radix keeps the panel mounted and hidden while collapsed.
    expect(screen.getByTestId("qa-overall-explain")).not.toBeVisible();
  });

  it("explains the worst-domain rule and why 'No information' reads as Unclear", async () => {
    const user = userEvent.setup();
    renderBanner(INCOMPLETE);
    await user.click(screen.getByTestId("qa-overall-explain-toggle"));

    const panel = screen.getByTestId("qa-overall-explain");
    expect(panel).toHaveTextContent(qa.overallExplainRule);
    expect(panel).toHaveTextContent(qa.overallExplainNoInformation);
  });

  it("names the unjudged domain that is withholding the overall", async () => {
    const user = userEvent.setup();
    renderBanner(INCOMPLETE);
    await user.click(screen.getByTestId("qa-overall-explain-toggle"));

    const panel = screen.getByTestId("qa-overall-explain");
    // The blocking domain is named AND marked as unjudged…
    expect(panel).toHaveTextContent("Development D1: Participants");
    expect(panel).toHaveTextContent(qa.overallExplainInputNotJudged);
    // …while the judged one shows the judgment the rule actually consumed.
    expect(panel).toHaveTextContent("Development D2: Predictors");
    expect(panel).toHaveTextContent("Unclear");
    expect(panel).toHaveTextContent(qa.overallExplainIncomplete);
  });

  it("omits the incomplete explanation when every overall computed", async () => {
    const user = userEvent.setup();
    renderBanner([
      {
        id: "dev_overall_quality",
        label: "Overall quality (development)",
        value: "High",
        inputs: [{ label: "Development D1: Participants", value: "High" }],
      },
    ]);
    await user.click(screen.getByTestId("qa-overall-explain-toggle"));
    expect(screen.getByTestId("qa-overall-explain")).not.toHaveTextContent(
      qa.overallExplainIncomplete,
    );
  });

  it("hides the toggle for a payload with no breakdown (older backend)", () => {
    renderBanner([{ id: "x", label: "Overall quality", value: "Low" }]);
    expect(screen.queryByTestId("qa-overall-explain-toggle")).not.toBeInTheDocument();
  });
});
