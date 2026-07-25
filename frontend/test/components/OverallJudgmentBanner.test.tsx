import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  OverallJudgmentBanner,
  type DerivedJudgmentView,
} from "@/components/assessment/OverallJudgmentBanner";
import { TooltipProvider } from "@/components/ui/tooltip";

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
