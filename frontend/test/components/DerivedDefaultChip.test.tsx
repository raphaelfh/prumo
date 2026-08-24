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
