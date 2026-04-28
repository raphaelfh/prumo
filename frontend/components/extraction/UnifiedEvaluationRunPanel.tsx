import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAdvanceRun, useCreateRun, useRun } from "@/hooks/runs";

interface UnifiedEvaluationRunPanelProps {
  projectId: string;
  articleId: string;
  projectTemplateId: string;
}

export function UnifiedEvaluationRunPanel({
  projectId,
  articleId,
  projectTemplateId,
}: UnifiedEvaluationRunPanelProps) {
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const runQuery = useRun(currentRunId);

  const createRunMutation = useCreateRun();
  const advanceMutation = useAdvanceRun(currentRunId ?? "");

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">Unified Evaluation Run</h3>
      <div className="flex gap-2">
        <Button
          onClick={() =>
            createRunMutation.mutate(
              {
                project_id: projectId,
                article_id: articleId,
                project_template_id: projectTemplateId,
              },
              {
                onSuccess: (run) => setCurrentRunId(run.id),
              },
            )
          }
          disabled={createRunMutation.isPending}
        >
          Create run
        </Button>
        <Button
          variant="secondary"
          onClick={() => advanceMutation.mutate({ target_stage: "proposal" })}
          disabled={!currentRunId || advanceMutation.isPending}
        >
          Advance to proposal
        </Button>
      </div>
      {currentRunId && (
        <p className="text-sm text-muted-foreground">
          Current run: {currentRunId} ({runQuery.data?.run.stage ?? "loading"})
        </p>
      )}
    </div>
  );
}

export default UnifiedEvaluationRunPanel;
