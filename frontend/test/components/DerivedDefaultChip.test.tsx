/**
 * The derived-default chip: renders the backend-computed recommendation for
 * an assessor-owned domain judgment (spec 2026-08-22 §6). All rule knowledge
 * stays server-side — the chip highlights and colors breakdown rows by the
 * payload's `contribution` field only.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DerivedDefaultChip } from "@/components/assessment/DerivedDefaultChip";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qa } from "@/lib/copy/qa";

const ENTRY = {
  id: "dev_d1_quality",
  label: "Development D1: quality",
  value: "High",
  inputs: [
    { label: "Q1 data sources", value: "PN", contribution: "High" },
    { label: "Q2 study design", value: "Y", contribution: "Low" },
    { label: "Q3 representative", value: null, contribution: null },
  ],
  target_entity_type_id: "et1",
  target_field_id: "j1",
  rationale_field_id: "r1",
  summary_field_id: null,
  rationale_required: false,
};

describe("DerivedDefaultChip", () => {
  it("shows the derived value and applies it through onApply", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <TooltipProvider>
        <DerivedDefaultChip judgment={ENTRY} onApply={onApply} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("qa-derived-chip-dev_d1_quality")).toHaveTextContent(
      "High",
    );
    await user.click(screen.getByTestId("qa-derived-apply-dev_d1_quality"));
    expect(onApply).toHaveBeenCalledWith("High");
  });

  it("breakdown rows carry the RAW answer and highlight by contribution", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <DerivedDefaultChip judgment={ENTRY} onApply={() => {}} />
      </TooltipProvider>,
    );
    await user.click(screen.getByTestId("qa-derived-explain-toggle-dev_d1_quality"));
    const rows = screen.getAllByTestId(/qa-derived-input-row/);
    expect(rows).toHaveLength(3);
    // The reviewer's own vocabulary, never the mapped judgment.
    expect(rows[0]).toHaveTextContent("PN");
    // Causing rows (contribution === entry value) are highlighted.
    expect(rows[0]).toHaveAttribute("data-causes", "true");
    expect(rows[1]).toHaveAttribute("data-causes", "false");
    // Unanswered rows show as not answered.
    expect(rows[2]).toHaveAttribute("data-causes", "false");
  });

  it("incomplete default: no Apply, incomplete copy", () => {
    render(
      <TooltipProvider>
        <DerivedDefaultChip judgment={{ ...ENTRY, value: null }} onApply={() => {}} />
      </TooltipProvider>,
    );
    expect(
      screen.queryByTestId("qa-derived-apply-dev_d1_quality"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("qa-derived-chip-dev_d1_quality"),
    ).toBeInTheDocument();
  });
});

describe("DerivedDefaultChip — collapse-group rows", () => {
  // A collapse group has no single stored answer, so `value` is null on EVERY
  // group row. What separates them is `contribution` (the group resolved to a
  // judgment) and, when it resolved to nothing, `state` — `"unreported"` (the
  // study never reported that performance type: a finished assessment) vs
  // `"in-progress"` (half-answered: a real gap). A group row that carries
  // neither is not a shape the backend emits.
  const D4 = {
    ...ENTRY,
    id: "eval_d4_rob",
    label: "Evaluation D4: Analysis",
    value: "High",
    inputs: [
      { label: "Internal validation", value: null, contribution: "High" },
      { label: "Apparent performance", value: null, contribution: null, state: "in-progress" },
      { label: "External validation", value: null, contribution: null, state: "unreported" },
    ],
  };

  async function openBreakdown() {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <DerivedDefaultChip judgment={D4} onApply={() => {}} />
      </TooltipProvider>,
    );
    await user.click(screen.getByTestId("qa-derived-explain-toggle-eval_d4_rob"));
    return screen.getAllByTestId(/qa-derived-input-row/);
  }

  it("a judged group displays its resolved contribution, never 'Not answered'", async () => {
    const rows = await openBreakdown();
    expect(rows[0]).toHaveTextContent("High");
    expect(rows[0]).toHaveAttribute("data-causes", "true");
    expect(rows[0]).not.toHaveTextContent(qa.derivedInputNotAnswered);
  });

  it("separates a performance type the study never reported from an unfinished one", async () => {
    const rows = await openBreakdown();
    expect(rows[1]).toHaveTextContent(qa.derivedInputInProgress);
    expect(rows[2]).toHaveTextContent(qa.derivedInputUnreported);
    // Neither is "Not answered" — that copy is for a plain signaling question
    // the reviewer skipped, and saying it here calls a finished assessment
    // unfinished.
    expect(rows[1]).not.toHaveTextContent(qa.derivedInputNotAnswered);
    expect(rows[2]).not.toHaveTextContent(qa.derivedInputNotAnswered);
  });

  it("warns only on the unfinished group, mutes the unreported one", async () => {
    await openBreakdown();
    // Actionable: the reviewer still has answers to give here.
    expect(screen.getByText(qa.derivedInputInProgress)).toHaveClass("text-warning");
    // Nothing to act on: the study did not do external validation.
    expect(screen.getByText(qa.derivedInputUnreported)).toHaveClass("text-muted-foreground");
  });

  it("still reads as not answered when a plain question was skipped", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <DerivedDefaultChip judgment={ENTRY} onApply={() => {}} />
      </TooltipProvider>,
    );
    await user.click(screen.getByTestId("qa-derived-explain-toggle-dev_d1_quality"));
    const rows = screen.getAllByTestId(/qa-derived-input-row/);
    expect(rows[2]).toHaveTextContent(qa.derivedInputNotAnswered);
  });
});
