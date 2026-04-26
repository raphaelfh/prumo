import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { evaluationConsensusService } from "@/services/evaluationConsensusService";

interface UnifiedConsensusPanelProps {
  projectId: string;
  runId?: string;
  targetId: string;
  itemId: string;
  schemaVersionId: string;
}

export function UnifiedConsensusPanel({
  projectId,
  runId,
  targetId,
  itemId,
  schemaVersionId,
}: UnifiedConsensusPanelProps) {
  const [overrideJustification, setOverrideJustification] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [publishedStateId, setPublishedStateId] = useState<string | null>(null);

  const publishMutation = useMutation({
    mutationFn: async () =>
      evaluationConsensusService.publishConsensus({
        project_id: projectId,
        run_id: runId ?? null,
        target_id: targetId,
        item_id: itemId,
        schema_version_id: schemaVersionId,
        mode: "manual_override",
        override_value: { approved: true },
        override_justification: overrideJustification || "Manual override by reviewer",
      }),
    onSuccess: (data) => setPublishedStateId(data.id),
  });

  const evidenceMutation = useMutation({
    mutationFn: async () => {
      if (!publishedStateId || !selectedFileName) {
        throw new Error("Published state and filename are required");
      }
      return evaluationConsensusService.requestEvidenceUpload({
        project_id: projectId,
        entity_type: "published_state",
        entity_id: publishedStateId,
        filename: selectedFileName,
        mime_type: "application/pdf",
        size_bytes: 1024,
      });
    },
  });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">Consensus decision</h3>
      <Textarea
        value={overrideJustification}
        onChange={(event) => setOverrideJustification(event.target.value)}
        placeholder="Override justification"
      />
      <Button onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
        Publish consensus
      </Button>

      <div className="flex gap-2">
        <Input
          value={selectedFileName}
          onChange={(event) => setSelectedFileName(event.target.value)}
          placeholder="evidence.pdf"
        />
        <Button
          variant="secondary"
          onClick={() => evidenceMutation.mutate()}
          disabled={!publishedStateId || evidenceMutation.isPending}
        >
          Request evidence upload
        </Button>
      </div>
    </div>
  );
}

export default UnifiedConsensusPanel;
