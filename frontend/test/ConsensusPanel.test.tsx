import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConsensusPanel } from "@/components/runs/ConsensusPanel";
import type {
  ConsensusDecisionResponse,
  ReviewerDecisionResponse,
  RunDetailResponse,
} from "@/hooks/runs/types";
import type { ReviewerSummary } from "@/hooks/runs/useReviewerSummary";

function decision(
  partial: Partial<ReviewerDecisionResponse>,
): ReviewerDecisionResponse {
  return {
    id: partial.id ?? "dec-x",
    run_id: "run-1",
    instance_id: partial.instance_id ?? "inst-1",
    field_id: partial.field_id ?? "field-1",
    reviewer_id: partial.reviewer_id ?? "user-a",
    decision: partial.decision ?? "edit",
    proposal_record_id: null,
    value: partial.value ?? null,
    rationale: null,
    created_at: partial.created_at ?? "2026-04-28T10:00:00Z",
  };
}

function consensusDecision(
  partial: Partial<ConsensusDecisionResponse>,
): ConsensusDecisionResponse {
  return {
    id: partial.id ?? "cons-x",
    run_id: "run-1",
    instance_id: partial.instance_id ?? "inst-1",
    field_id: partial.field_id ?? "field-1",
    consensus_user_id: partial.consensus_user_id ?? "arbitrator-1",
    mode: partial.mode ?? "select_existing",
    selected_decision_id: partial.selected_decision_id ?? null,
    value: partial.value ?? null,
    rationale: partial.rationale ?? null,
    created_at: partial.created_at ?? "2026-04-28T11:00:00Z",
  };
}

function makeFixtures(): {
  runDetail: RunDetailResponse;
  summary: ReviewerSummary;
} {
  const decisions: ReviewerDecisionResponse[] = [
    decision({
      id: "dec-a",
      reviewer_id: "user-a",
      instance_id: "inst-1",
      field_id: "field-1",
      decision: "edit",
      value: { value: "Yes" },
    }),
    decision({
      id: "dec-b",
      reviewer_id: "user-b",
      instance_id: "inst-1",
      field_id: "field-1",
      decision: "edit",
      value: { value: "No" },
    }),
  ];

  const runDetail: RunDetailResponse = {
    run: {
      id: "run-1",
      project_id: "p1",
      article_id: "a1",
      template_id: "t1",
      kind: "extraction",
      version_id: "v1",
      stage: "consensus",
      status: "running",
      hitl_config_snapshot: { reviewer_count: 2 },
      parameters: {},
      results: {},
      created_at: "2026-04-28T09:00:00Z",
      created_by: "user-a",
    },
    proposals: [],
    decisions,
    consensus_decisions: [],
    published_states: [],
  };

  const summary: ReviewerSummary = {
    reviewers: ["user-a", "user-b"],
    currentDecisions: new Map([["inst-1::field-1", decisions[1]]]),
    decisionsByCoord: new Map([["inst-1::field-1", decisions]]),
    divergentCoords: new Set(["inst-1::field-1"]),
    requiredReviewerCount: 2,
    completionRatio: 1,
    filledCoords: new Set(["inst-1::field-1"]),
    touchedCoords: new Set(["inst-1::field-1"]),
  };

  return { runDetail, summary };
}

describe("ConsensusPanel", () => {
  function emptyDivergenceSummary(): ReviewerSummary {
    return {
      reviewers: ["user-a"],
      currentDecisions: new Map(),
      decisionsByCoord: new Map(),
      divergentCoords: new Set(),
      requiredReviewerCount: 1,
      completionRatio: 1,
      filledCoords: new Set(),
      touchedCoords: new Set(),
    };
  }

  it("fast-path: offers finalize only when complete with a consensus decision", async () => {
    const onFinalize = vi.fn();
    const { runDetail } = makeFixtures();
    runDetail.consensus_decisions = [consensusDecision({ id: "cons-1" })];

    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={emptyDivergenceSummary()}
        isComplete
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={onFinalize}
      />,
    );

    expect(screen.getByTestId("consensus-empty")).toBeInTheDocument();
    const button = screen.getByTestId("consensus-finalize-empty");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it("fast-path: blocks finalize when required fields are incomplete", () => {
    const onFinalize = vi.fn();
    const { runDetail } = makeFixtures();
    runDetail.consensus_decisions = [consensusDecision({ id: "cons-1" })];

    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={emptyDivergenceSummary()}
        isComplete={false}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={onFinalize}
      />,
    );

    const button = screen.getByTestId("consensus-finalize-empty");
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/fill every required field/i),
    ).toBeInTheDocument();
    expect(onFinalize).not.toHaveBeenCalled();
  });

  it("fast-path: blocks finalize when no consensus decision exists yet", () => {
    const { runDetail } = makeFixtures();
    runDetail.consensus_decisions = [];

    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={emptyDivergenceSummary()}
        isComplete
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    const button = screen.getByTestId("consensus-finalize-empty");
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/publish at least one field/i),
    ).toBeInTheDocument();
  });

  it("renders one card per divergent coord with each reviewer's value", () => {
    const { runDetail, summary } = makeFixtures();
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        fieldLabelByCoord={{ "inst-1::field-1": "Domain · Field" }}
        reviewerLabelById={{ "user-a": "Alice", "user-b": "Bob" }}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    expect(screen.getByText("Domain · Field")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText('"Yes"')).toBeInTheDocument();
    expect(screen.getByText('"No"')).toBeInTheDocument();
  });

  it("invokes onSelectExisting with the chosen decision id", async () => {
    const { runDetail, summary } = makeFixtures();
    const onSelectExisting = vi.fn();

    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        onSelectExisting={onSelectExisting}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("consensus-accept-dec-a"));
    expect(onSelectExisting).toHaveBeenCalledWith({
      instanceId: "inst-1",
      fieldId: "field-1",
      decisionId: "dec-a",
    });
  });

  it("disables the finalize button until every divergent coord is resolved", () => {
    const { runDetail, summary } = makeFixtures();
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    const button = screen.getByTestId("consensus-finalize-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("1 left");
  });

  it("enables finalize and renders resolved badge when consensus exists for all coords", () => {
    const { runDetail, summary } = makeFixtures();
    runDetail.consensus_decisions = [
      consensusDecision({
        id: "cons-1",
        instance_id: "inst-1",
        field_id: "field-1",
        mode: "select_existing",
        selected_decision_id: "dec-a",
      }),
    ];

    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("consensus-coord-resolved-inst-1::field-1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("consensus-finalize-button")).toBeEnabled();
  });

  it("opens override editor and submits a custom value with rationale", async () => {
    const { runDetail, summary } = makeFixtures();
    const onManualOverride = vi.fn();
    const user = userEvent.setup();

    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        onSelectExisting={vi.fn()}
        onManualOverride={onManualOverride}
        onFinalize={vi.fn()}
      />,
    );

    await user.click(
      screen.getByTestId("consensus-override-toggle-inst-1::field-1"),
    );

    await user.type(
      screen.getByLabelText(/Custom value/i),
      '"Maybe"',
    );
    await user.type(
      screen.getByLabelText(/Rationale/i),
      "Compromise picked by arbitrator.",
    );

    await user.click(
      screen.getByTestId("consensus-override-submit-inst-1::field-1"),
    );

    expect(onManualOverride).toHaveBeenCalledWith({
      instanceId: "inst-1",
      fieldId: "field-1",
      value: "Maybe",
      rationale: "Compromise picked by arbitrator.",
    });
  });
});

describe("ConsensusPanel — evaluate-all (extraction)", () => {
  function evaluateAllFixtures(): {
    runDetail: RunDetailResponse;
    summary: ReviewerSummary;
  } {
    // field-1 diverges (Yes/No); field-2 is agreed (Same/Same).
    const divergent: ReviewerDecisionResponse[] = [
      decision({ id: "d1a", reviewer_id: "user-a", field_id: "field-1", value: { value: "Yes" } }),
      decision({ id: "d1b", reviewer_id: "user-b", field_id: "field-1", value: { value: "No" } }),
    ];
    const agreed: ReviewerDecisionResponse[] = [
      decision({ id: "d2a", reviewer_id: "user-a", field_id: "field-2", value: { value: "Same" } }),
      decision({ id: "d2b", reviewer_id: "user-b", field_id: "field-2", value: { value: "Same" } }),
    ];
    const runDetail: RunDetailResponse = {
      run: {
        id: "run-1", project_id: "p1", article_id: "a1", template_id: "t1", kind: "extraction",
        version_id: "v1", stage: "consensus", status: "running",
        hitl_config_snapshot: { reviewer_count: 2 }, parameters: {}, results: {},
        created_at: "2026-04-28T09:00:00Z", created_by: "user-a",
      },
      proposals: [],
      decisions: [...divergent, ...agreed],
      consensus_decisions: [],
      published_states: [],
    };
    const summary: ReviewerSummary = {
      reviewers: ["user-a", "user-b"],
      currentDecisions: new Map(),
      decisionsByCoord: new Map([
        ["inst-1::field-1", divergent],
        ["inst-1::field-2", agreed],
      ]),
      divergentCoords: new Set(["inst-1::field-1"]),
      requiredReviewerCount: 2,
      completionRatio: 1,
      filledCoords: new Set(["inst-1::field-1", "inst-1::field-2"]),
      touchedCoords: new Set(["inst-1::field-1", "inst-1::field-2"]),
    };
    return { runDetail, summary };
  }

  it("renders ALL coords (agreed + diverging) and hides the in-panel finalize when showFinalize=false", () => {
    const { runDetail, summary } = evaluateAllFixtures();
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        fieldLabelByCoord={{
          "inst-1::field-1": "Sec · Diverging",
          "inst-1::field-2": "Sec · Agreed",
        }}
        evaluateAllCoords={["inst-1::field-1", "inst-1::field-2"]}
        showFinalize={false}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );
    // Both coords render (agreed coord is NOT in divergentCoords yet still shown).
    expect(screen.getByText("Sec · Diverging")).toBeInTheDocument();
    expect(screen.getByText("Sec · Agreed")).toBeInTheDocument();
    expect(screen.getByText("Review every field")).toBeInTheDocument();
    // The header owns finalize for extraction — no in-panel finalize button.
    expect(screen.queryByTestId("consensus-finalize-button")).toBeNull();
  });

  it("evaluate-all with zero divergence renders the grid (not the no-conflicts fast-path)", () => {
    const { runDetail, summary } = evaluateAllFixtures();
    summary.divergentCoords = new Set(); // everything agrees
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        fieldLabelByCoord={{ "inst-1::field-2": "Sec · Agreed" }}
        evaluateAllCoords={["inst-1::field-2"]}
        showFinalize={false}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("consensus-empty")).toBeNull();
    expect(screen.getByText("Sec · Agreed")).toBeInTheDocument();
    expect(screen.queryByTestId("consensus-finalize-button")).toBeNull();
  });
});
