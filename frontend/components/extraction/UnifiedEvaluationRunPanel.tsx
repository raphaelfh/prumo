import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEvaluationRun } from "@/hooks/evaluation/useEvaluationQueries";
import { evaluationService } from "@/services/evaluationService";

interface UnifiedEvaluationRunPanelProps {
  projectId: string;
  schemaVersionId: string;
  defaultTargetIds: string[];
}

export function UnifiedEvaluationRunPanel({
  projectId,
  schemaVersionId,
  defaultTargetIds,
}: UnifiedEvaluationRunPanelProps) {
  const [runName, setRunName] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const runQuery = useEvaluationRun({ runId: currentRunId });

  const createRunMutation = useMutation({
    mutationFn: async () =>
      evaluationService.createRun({
        project_id: projectId,
        schema_version_id: schemaVersionId,
        target_ids: defaultTargetIds,
        name: runName || undefined,
      }),
    onSuccess: (run) => setCurrentRunId(run.id),
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!currentRunId) {
        throw new Error("Missing current run id");
      }
      await evaluationService.startProposalGeneration(currentRunId);
    },
  });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">Unified Evaluation Run</h3>
      <Input
        value={runName}
        onChange={(event) => setRunName(event.target.value)}
        placeholder="Optional run name"
      />
      <div className="flex gap-2">
        <Button onClick={() => createRunMutation.mutate()} disabled={createRunMutation.isPending}>
          Create run
        </Button>
        <Button
          variant="secondary"
          onClick={() => startMutation.mutate()}
          disabled={!currentRunId || startMutation.isPending}
        >
          Start proposal generation
        </Button>
      </div>
      {currentRunId && (
        <p className="text-sm text-muted-foreground">
          Current run: {currentRunId} ({runQuery.data?.status ?? "loading"})
        </p>
      )}
    </div>
  );
}

export default UnifiedEvaluationRunPanel;
