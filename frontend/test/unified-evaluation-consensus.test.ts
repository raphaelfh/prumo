import { describe, expect, it, vi } from "vitest";

import { evaluationConsensusService } from "@/services/evaluationConsensusService";

describe("Unified consensus flow", () => {
  it("publishes consensus and requests evidence upload", async () => {
    const publishSpy = vi.spyOn(evaluationConsensusService, "publishConsensus").mockResolvedValue({
      id: "published-1",
      project_id: "project-1",
      target_id: "target-1",
      item_id: "item-1",
      schema_version_id: "schema-1",
      latest_consensus_decision_id: "consensus-1",
    });
    const evidenceSpy = vi.spyOn(evaluationConsensusService, "requestEvidenceUpload").mockResolvedValue({
      upload_url: "https://upload.local",
      storage_path: "evidence/path",
    });

    const published = await evaluationConsensusService.publishConsensus({
      project_id: "project-1",
      target_id: "target-1",
      item_id: "item-1",
      schema_version_id: "schema-1",
      mode: "manual_override",
      override_value: { approved: true },
      override_justification: "Documented override",
    });

    await evaluationConsensusService.requestEvidenceUpload({
      project_id: "project-1",
      entity_type: "published_state",
      entity_id: published.id,
      filename: "evidence.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
    });

    expect(publishSpy).toHaveBeenCalledOnce();
    expect(evidenceSpy).toHaveBeenCalledOnce();
  });
});
