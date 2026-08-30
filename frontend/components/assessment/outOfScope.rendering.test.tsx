/**
 * The wire contract for `RunViewDerivedInput.state` says out-of-scope
 * "outranks the other two — render it as 'Not applicable', never as
 * unfinished work". PR2 started stamping it and nothing read it, so both
 * surfaces fell through to their generic "nothing here" branch and told the
 * reviewer, in warning tone, that an inapplicable part of the instrument was
 * still owed — while the section header right above carried the muted
 * "Out of scope for this study type" badge.
 *
 * These tests pin the contract on both readers at once, because the failure
 * was one screen contradicting itself.
 */
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { DerivedDefaultChip } from "@/components/assessment/DerivedDefaultChip";
import { OverallJudgmentBanner } from "@/components/assessment/OverallJudgmentBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qa } from "@/lib/copy/qa";

const render = (ui: ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

/**
 * Both breakdowns live behind a collapsed disclosure, so every row assertion
 * must open it first — asserting on a closed Collapsible passes vacuously.
 */
const openDisclosure = (testId: string) =>
  fireEvent.click(screen.getByTestId(testId));

const excluded = (label: string) => ({
  label,
  value: null,
  contribution: null,
  state: "out-of-scope",
});
const unanswered = (label: string) => ({ label, value: null, contribution: null });

describe("OverallJudgmentBanner — an overall whose inputs are all out of scope", () => {
  const outOfScopeOverall = {
    id: "eval_overall_rob",
    label: "Evaluation overall risk of bias",
    value: null,
    inputs: [excluded("Evaluation D1"), excluded("Evaluation D2")],
  };

  it("reads 'Not applicable', not the incomplete dash", () => {
    render(<OverallJudgmentBanner judgments={[outOfScopeOverall]} />);
    const badge = screen.getByTestId("qa-overall-eval_overall_rob");
    expect(badge).toHaveTextContent(qa.outOfScopeValue);
    expect(badge).not.toHaveTextContent(qa.overallIncomplete);
  });

  it("does not tell the reviewer to go judge the excluded domains", () => {
    render(<OverallJudgmentBanner judgments={[outOfScopeOverall]} />);
    openDisclosure("qa-overall-explain-toggle");
    expect(screen.queryByText(qa.overallExplainIncomplete)).not.toBeInTheDocument();
  });

  it("renders each excluded contributing domain muted, never warning-toned", () => {
    render(<OverallJudgmentBanner judgments={[outOfScopeOverall]} />);
    openDisclosure("qa-overall-explain-toggle");
    const row = screen.getAllByText(qa.outOfScopeValue)[1];
    expect(row).toHaveClass("text-muted-foreground");
    expect(row).not.toHaveClass("text-warning");
  });

  it("still calls a GENUINELY unfinished overall incomplete", () => {
    // The blank must keep meaning "unfinished" where the part does apply —
    // the fix must not turn every dash into "Not applicable".
    render(
      <OverallJudgmentBanner
        judgments={[
          {
            id: "dev_overall_quality",
            label: "Development overall",
            value: null,
            inputs: [unanswered("Development D1")],
          },
        ]}
      />,
    );
    const badge = screen.getByTestId("qa-overall-dev_overall_quality");
    expect(badge).toHaveTextContent(qa.overallIncomplete);
    openDisclosure("qa-overall-explain-toggle");
    expect(screen.getByText(qa.overallExplainIncomplete)).toBeInTheDocument();
  });

  it("a partly-excluded overall is still unfinished, not applicable", () => {
    // The rules exclude whole parts, so this should not arise — but "some
    // inputs excluded" must never be rounded up to "nothing to do".
    render(
      <OverallJudgmentBanner
        judgments={[
          {
            id: "mixed",
            label: "Mixed",
            value: null,
            inputs: [excluded("D1"), unanswered("D2")],
          },
        ]}
      />,
    );
    expect(screen.getByTestId("qa-overall-mixed")).toHaveTextContent(qa.overallIncomplete);
  });
});

describe("DerivedDefaultChip — a recommendation whose inputs are all out of scope", () => {
  const chip = (inputs: Array<Record<string, unknown>>) => (
    <DerivedDefaultChip
      judgment={
        { id: "eval_d1_rob", label: "Evaluation D1", value: null, inputs } as never
      }
      onApply={() => {}}
    />
  );

  it("reads 'Not applicable' instead of 'Incomplete'", () => {
    render(chip([excluded("1.1"), excluded("1.2")]));
    expect(screen.getByTestId("qa-derived-chip-eval_d1_rob")).toHaveTextContent(
      qa.outOfScopeValue,
    );
  });

  it("renders each excluded signaling row muted, not as work still owed", () => {
    render(chip([excluded("1.1")]));
    openDisclosure("qa-derived-explain-toggle-eval_d1_rob");
    const rows = screen.getAllByTestId("qa-derived-input-row-eval_d1_rob");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(qa.outOfScopeValue);
    expect(rows[0].textContent).not.toContain(qa.derivedInputNotAnswered);
    expect(rows[0].querySelector(".text-warning")).toBeNull();
  });

  it("keeps 'Incomplete' where the domain genuinely applies", () => {
    render(chip([unanswered("1.1")]));
    expect(screen.getByTestId("qa-derived-chip-eval_d1_rob")).toHaveTextContent(
      qa.derivedDefaultIncomplete,
    );
    openDisclosure("qa-derived-explain-toggle-eval_d1_rob");
    expect(screen.getAllByTestId("qa-derived-input-row-eval_d1_rob")[0]).toHaveTextContent(
      qa.derivedInputNotAnswered,
    );
  });

  it("out-of-scope outranks the other two states on the same row", () => {
    // Per the schema docstring: it is the only state a PLAIN row carries and
    // it wins over unreported / in-progress on a collapse group.
    render(chip([{ label: "D4 apparent", value: null, contribution: null, state: "out-of-scope" }]));
    openDisclosure("qa-derived-explain-toggle-eval_d1_rob");
    const row = screen.getAllByTestId("qa-derived-input-row-eval_d1_rob")[0];
    expect(row).toHaveTextContent(qa.outOfScopeValue);
    expect(row.textContent).not.toContain(qa.derivedInputUnreported);
  });
});
