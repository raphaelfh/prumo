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
  it("groups a divergence under the Conflicts section", () => {
    const { runDetail, summary } = makeFixtures();
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        fieldLabelByCoord={{ "inst-1::field-1": "Section · Field 1" }}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );
    expect(screen.getByTestId("consensus-section-conflicts")).toBeInTheDocument();
    expect(screen.getByText("Section · Field 1")).toBeInTheDocument();
  });

  it("does not render the internal decision verb as a badge", () => {
    const { runDetail, summary } = makeFixtures();
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );
    // "edit" was the decision-verb badge; reviewer values "Yes"/"No" remain.
    expect(screen.queryByText("edit")).not.toBeInTheDocument();
  });

  it("shows an agreed-count hint and a required-gap row", () => {
    // One agreed coord (both reviewers "Yes") + one untouched required coord.
    const decisions: ReviewerDecisionResponse[] = [
      decision({ id: "d1", reviewer_id: "user-a", instance_id: "i", field_id: "ag", value: { value: "Yes" } }),
      decision({ id: "d2", reviewer_id: "user-b", instance_id: "i", field_id: "ag", value: { value: "Yes" } }),
    ];
    const summary: ReviewerSummary = {
      reviewers: ["user-a", "user-b"],
      currentDecisions: new Map(),
      decisionsByCoord: new Map([["i::ag", decisions]]),
      divergentCoords: new Set(),
      requiredReviewerCount: 2,
      completionRatio: 1,
      filledCoords: new Set(["i::ag"]),
      touchedCoords: new Set(["i::ag"]),
    };
    const runDetail = { ...makeFixtures().runDetail, decisions, consensus_decisions: [], published_states: [] };
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        requiredCoords={["i::gap"]}
        peersRevealed={true}
        fieldLabelByCoord={{ "i::ag": "S · Agreed", "i::gap": "S · Required" }}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );
    expect(screen.getByTestId("consensus-section-agreed")).toHaveTextContent("1 field agreed");
    expect(screen.getByTestId("consensus-section-attention")).toHaveTextContent("S · Required");
  });

  it("renders each reviewer's value under the conflict row", () => {
    const { runDetail, summary } = makeFixtures();
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        fieldLabelByCoord={{ "inst-1::field-1": "Domain · Field" }}
        reviewerLabelById={{ "user-a": "Alice", "user-b": "Bob" }}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
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
        requiredCoords={[]}
        peersRevealed={true}
        onSelectExisting={onSelectExisting}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );

    await userEvent.click(screen.getByTestId("consensus-accept-dec-a"));
    expect(onSelectExisting).toHaveBeenCalledWith({
      instanceId: "inst-1",
      fieldId: "field-1",
      decisionId: "dec-a",
    });
  });

  it("QA: disables the in-panel finalize until conflicts are resolved", () => {
    const { runDetail, summary } = makeFixtures();
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        isComplete
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize
      />,
    );

    expect(screen.getByTestId("consensus-finalize-button")).toBeDisabled();
  });

  it("QA: disables finalize when all agreed but consensus_decisions is empty", () => {
    // Agreements-only run: no divergent coords, isComplete, but zero consensus decisions.
    // Backend rejects finalize with EmptyFinalizeError when consensus_count===0.
    const agreeDecisions: ReviewerDecisionResponse[] = [
      decision({ id: "d1", reviewer_id: "user-a", instance_id: "i", field_id: "ag", value: { value: "Yes" } }),
      decision({ id: "d2", reviewer_id: "user-b", instance_id: "i", field_id: "ag", value: { value: "Yes" } }),
    ];
    const agreedSummary: ReviewerSummary = {
      reviewers: ["user-a", "user-b"],
      currentDecisions: new Map(),
      decisionsByCoord: new Map([["i::ag", agreeDecisions]]),
      divergentCoords: new Set(),
      requiredReviewerCount: 2,
      completionRatio: 1,
      filledCoords: new Set(["i::ag"]),
      touchedCoords: new Set(["i::ag"]),
    };
    const runDetail = {
      ...makeFixtures().runDetail,
      decisions: agreeDecisions,
      consensus_decisions: [] as ConsensusDecisionResponse[],
      published_states: [],
    };
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={agreedSummary}
        requiredCoords={[]}
        peersRevealed={true}
        isComplete={true}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={true}
      />,
    );
    expect(screen.getByTestId("consensus-finalize-button")).toBeDisabled();
  });

  it("QA: enables the in-panel finalize and renders the resolved badge once every conflict has a consensus decision", () => {
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
        requiredCoords={[]}
        peersRevealed={true}
        isComplete
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize
      />,
    );

    expect(
      screen.getByTestId("consensus-coord-resolved-inst-1::field-1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("consensus-finalize-button")).toBeEnabled();
  });

  it("QA: invokes onFinalize from the in-panel finalize bar", async () => {
    const onFinalize = vi.fn();
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
        requiredCoords={[]}
        peersRevealed={true}
        isComplete
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={onFinalize}
        showFinalize
      />,
    );

    await userEvent.click(screen.getByTestId("consensus-finalize-button"));
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it("opens override editor and submits a custom value with rationale", async () => {
    const { runDetail, summary } = makeFixtures();
    const onManualOverride = vi.fn();
    const user = userEvent.setup();

    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        onSelectExisting={vi.fn()}
        onManualOverride={onManualOverride}
        onFinalize={vi.fn()}
        showFinalize={false}
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

  it("shows the published custom value + rationale + a Change button when resolved", async () => {
    const { runDetail, summary } = makeFixtures(); // divergent inst-1::field-1
    const resolved = consensusDecision({
      instance_id: "inst-1",
      field_id: "field-1",
      mode: "manual_override",
      value: { value: "Reconciled" },
      rationale: "agreed offline",
    });
    render(
      <ConsensusPanel
        runDetail={{ ...runDetail, consensus_decisions: [resolved] }}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );
    expect(screen.getByText("Reconciled")).toBeInTheDocument();
    expect(screen.getByText("agreed offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("resolved select_existing: shows reviewer provenance when peersRevealed=true", () => {
    const { runDetail, summary } = makeFixtures(); // divergent inst-1::field-1, decisions dec-a (user-a) / dec-b (user-b)
    const resolved = consensusDecision({
      instance_id: "inst-1",
      field_id: "field-1",
      mode: "select_existing",
      selected_decision_id: "dec-a",
      value: { value: "Yes" },
      rationale: null,
    });
    render(
      <ConsensusPanel
        runDetail={{ ...runDetail, consensus_decisions: [resolved] }}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        reviewerLabelById={{ "user-a": "Alice", "user-b": "Bob" }}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );
    // resolvedFromReviewer copy: "from {{reviewer}}" → "from Alice"
    expect(screen.getByTestId("consensus-resolved-inst-1::field-1")).toHaveTextContent("from Alice");
  });

  it("resolved select_existing: hides reviewer name when peersRevealed=false", () => {
    const { runDetail, summary } = makeFixtures();
    const resolved = consensusDecision({
      instance_id: "inst-1",
      field_id: "field-1",
      mode: "select_existing",
      selected_decision_id: "dec-a",
      value: { value: "Yes" },
      rationale: null,
    });
    render(
      <ConsensusPanel
        runDetail={{ ...runDetail, consensus_decisions: [resolved] }}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={false}
        reviewerLabelById={{ "user-a": "Alice", "user-b": "Bob" }}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );
    const resolvedBox = screen.getByTestId("consensus-resolved-inst-1::field-1");
    // Should NOT show the reviewer's name (blind-safety guarantee)
    expect(resolvedBox).not.toHaveTextContent("Alice");
    // Falls back to the custom-value label
    expect(resolvedBox).toHaveTextContent("custom value");
  });

  it("resolved select_existing: shows Cancel and re-enables Use this value buttons when Change clicked", async () => {
    const onSelectExisting = vi.fn();
    const { runDetail, summary } = makeFixtures();
    const resolved = consensusDecision({
      instance_id: "inst-1",
      field_id: "field-1",
      mode: "select_existing",
      selected_decision_id: "dec-a",
      value: { value: "Yes" },
      rationale: null,
    });
    render(
      <ConsensusPanel
        runDetail={{ ...runDetail, consensus_decisions: [resolved] }}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        reviewerLabelById={{ "user-a": "Alice", "user-b": "Bob" }}
        onSelectExisting={onSelectExisting}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );

    // Click Change to enter editing mode
    await userEvent.click(screen.getByRole("button", { name: "Change" }));

    // Cancel button appears
    expect(screen.getByTestId("consensus-cancel-edit-inst-1::field-1")).toBeInTheDocument();

    // "Use this value" buttons are now visible for both reviewers
    expect(screen.getByTestId("consensus-accept-dec-a")).toBeInTheDocument();
    expect(screen.getByTestId("consensus-accept-dec-b")).toBeInTheDocument();

    // Click Cancel — reverts to resolved summary
    await userEvent.click(screen.getByTestId("consensus-cancel-edit-inst-1::field-1"));
    expect(screen.getByTestId("consensus-resolved-inst-1::field-1")).toBeInTheDocument();
    expect(screen.queryByTestId("consensus-cancel-edit-inst-1::field-1")).toBeNull();
  });

  it("resolved manual_override: Change pre-fills value and rationale in override editor", async () => {
    const { runDetail, summary } = makeFixtures();
    const resolved = consensusDecision({
      instance_id: "inst-1",
      field_id: "field-1",
      mode: "manual_override",
      value: { value: "Reconciled" },
      rationale: "agreed offline",
    });
    render(
      <ConsensusPanel
        runDetail={{ ...runDetail, consensus_decisions: [resolved] }}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Change" }));

    // Override editor should be open and pre-filled
    const valueInput = screen.getByLabelText(/Custom value/i) as HTMLInputElement;
    const rationaleInput = screen.getByLabelText(/Rationale/i) as HTMLTextAreaElement;

    expect(valueInput.value).toBe("Reconciled");
    expect(rationaleInput.value).toBe("agreed offline");
  });

  it("extraction: renders the nothing-to-reconcile hint when no buckets and no in-panel finalize", () => {
    const summary: ReviewerSummary = {
      reviewers: ["user-a"],
      currentDecisions: new Map(),
      decisionsByCoord: new Map(),
      divergentCoords: new Set(),
      requiredReviewerCount: 1,
      completionRatio: 1,
      filledCoords: new Set(),
      touchedCoords: new Set(),
    };
    const runDetail = {
      ...makeFixtures().runDetail,
      decisions: [],
      consensus_decisions: [],
      published_states: [],
    };
    render(
      <ConsensusPanel
        runDetail={runDetail}
        summary={summary}
        requiredCoords={[]}
        peersRevealed={true}
        onSelectExisting={vi.fn()}
        onManualOverride={vi.fn()}
        onFinalize={vi.fn()}
        showFinalize={false}
      />,
    );
    expect(screen.getByTestId("consensus-nothing")).toBeInTheDocument();
    expect(screen.queryByTestId("consensus-finalize-button")).toBeNull();
  });
});
