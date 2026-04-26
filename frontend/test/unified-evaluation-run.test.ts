import { describe, expect, it, vi } from "vitest";

import { evaluationService } from "@/services/evaluationService";

describe("Unified evaluation run flow", () => {
  it("creates run then starts proposal generation", async () => {
    const createSpy = vi
      .spyOn(evaluationService, "createRun")
      .mockResolvedValue({
        id: "run-1",
        project_id: "project-1",
        schema_version_id: "schema-1",
        status: "pending",
        current_stage: "proposal",
      });
    const startSpy = vi.spyOn(evaluationService, "startProposalGeneration").mockResolvedValue();

    const run = await evaluationService.createRun({
      project_id: "project-1",
      schema_version_id: "schema-1",
      target_ids: ["target-1"],
    });
    await evaluationService.startProposalGeneration(run.id);

    expect(createSpy).toHaveBeenCalledOnce();
    expect(startSpy).toHaveBeenCalledWith("run-1");
  });
});
