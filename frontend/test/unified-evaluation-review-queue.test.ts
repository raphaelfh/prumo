import { describe, expect, it, vi } from "vitest";

import { evaluationReviewService } from "@/services/evaluationReviewService";

describe("Unified evaluation review queue flow", () => {
  it("loads queue and submits decision", async () => {
    const queueSpy = vi.spyOn(evaluationReviewService, "fetchReviewQueue").mockResolvedValue({
      items: [
        {
          run_id: "run-1",
          target_id: "target-1",
          item_id: "item-1",
          latest_proposal_id: "proposal-1",
          reviewer_state: "pending",
        },
      ],
    });
    const submitSpy = vi.spyOn(evaluationReviewService, "submitReviewerDecision").mockResolvedValue({
      id: "decision-1",
      reviewer_id: "reviewer-1",
      decision: "accept",
    });

    const queue = await evaluationReviewService.fetchReviewQueue({ runId: "run-1" });
    await evaluationReviewService.submitReviewerDecision({
      project_id: "project-1",
      run_id: "run-1",
      target_id: "target-1",
      item_id: "item-1",
      schema_version_id: "schema-1",
      decision: "accept",
    });

    expect(queueSpy).toHaveBeenCalledWith({ runId: "run-1" });
    expect(queue.items.length).toBe(1);
    expect(submitSpy).toHaveBeenCalledOnce();
  });
});
