import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCreateConsensus, useRun } from "@/hooks/runs";

interface UnifiedConsensusPanelProps {
  runId: string;
  instanceId: string;
  fieldId: string;
}

export function UnifiedConsensusPanel({
  runId,
  instanceId,
  fieldId,
}: UnifiedConsensusPanelProps) {
  const [overrideJustification, setOverrideJustification] = useState("");

  const runQuery = useRun(runId);
  const consensusMutation = useCreateConsensus(runId);

  const publishedStates = runQuery.data?.published_states ?? [];
  const publishedForCoord = publishedStates.find(
    (state) => state.instance_id === instanceId && state.field_id === fieldId,
  );

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">Consensus decision</h3>
      <Textarea
        value={overrideJustification}
        onChange={(event) => setOverrideJustification(event.target.value)}
        placeholder="Override justification"
      />
      <Button
        onClick={() =>
          consensusMutation.mutate({
            instance_id: instanceId,
            field_id: fieldId,
            mode: "manual_override",
            value: { approved: true },
            rationale: overrideJustification || "Manual override by reviewer",
          })
        }
        disabled={consensusMutation.isPending}
      >
        Publish consensus
      </Button>

      {publishedForCoord && (
        <p className="text-sm text-muted-foreground">
          Published state: {publishedForCoord.id} (v{publishedForCoord.version})
        </p>
      )}
    </div>
  );
}

export default UnifiedConsensusPanel;
