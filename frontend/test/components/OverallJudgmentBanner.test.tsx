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

// A collapse group has no stored answer, so `value` is null whether the study
// never reported that performance type or the reviewer simply has not finished
// it. Both used to render as warning-toned "Not judged", which told a reviewer
// with a COMPLETE assessment that it was unfinished. `state` is what separates
// them, and the tone is the whole point: only one of the two is actionable.
describe("OverallJudgmentBanner — unreported vs in-progress collapse groups", () => {
  const D4: DerivedJudgmentView[] = [
    {
      id: "eval_d4_rob",
      label: "Evaluation D4: Analysis",
      value: null,
      inputs: [
        { label: "Apparent performance", value: null, contribution: "Low" },
        { label: "External validation", value: null, state: "unreported" },
        { label: "Internal validation", value: null, state: "in-progress" },
      ],
    },
  ];

  async function openDisclosure() {
    const user = userEvent.setup();
    renderBanner(D4);
    await user.click(screen.getByTestId("qa-overall-explain-toggle"));
  }

  /** One breakdown row. Assertions target the row, never the whole panel —
   * the disclosure's own prose quotes "Not judged", so a panel-wide negative
   * assertion would be unfalsifiable. */
  function rowFor(label: string): HTMLElement {
    const row = screen.getByText(label).closest("li");
    if (!row) throw new Error(`no breakdown row labelled ${label}`);
    return row;
  }

  it("labels an unreported performance type as reported-absent, not unjudged", async () => {
    await openDisclosure();
    expect(rowFor("External validation")).toHaveTextContent(qa.overallExplainInputUnreported);
    expect(rowFor("External validation")).not.toHaveTextContent(qa.overallExplainInputNotJudged);
  });

  it("labels a half-answered group as in progress", async () => {
    await openDisclosure();
    expect(rowFor("Internal validation")).toHaveTextContent(qa.overallExplainInputInProgress);
    expect(rowFor("Internal validation")).not.toHaveTextContent(qa.overallExplainInputNotJudged);
  });

  it("shows the judgment a group contributed, since a group has no stored answer", async () => {
    await openDisclosure();
    expect(rowFor("Apparent performance")).toHaveTextContent("Low");
    expect(rowFor("Apparent performance")).not.toHaveTextContent(qa.overallExplainInputNotJudged);
  });

  it("mutes the unreported group and warns only on the unfinished one", async () => {
    await openDisclosure();
    // Muted: the study did not do external validation — nothing to act on.
    expect(screen.getByText(qa.overallExplainInputUnreported)).toHaveClass("text-muted-foreground");
    // Warning: this one really is a gap the reviewer still has to close.
    expect(screen.getByText(qa.overallExplainInputInProgress)).toHaveClass("text-warning");
  });
});
