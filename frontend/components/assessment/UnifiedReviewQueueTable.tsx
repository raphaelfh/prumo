import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useReviewQueue } from "@/hooks/evaluation/useEvaluationQueries";
import { evaluationReviewService } from "@/services/evaluationReviewService";

interface UnifiedReviewQueueTableProps {
  projectId: string;
  runId?: string;
  schemaVersionId: string;
}

export function UnifiedReviewQueueTable({
  projectId,
  runId,
  schemaVersionId,
}: UnifiedReviewQueueTableProps) {
  const queueQuery = useReviewQueue({ runId, status: "pending" });

  const decisionMutation = useMutation({
    mutationFn: async (input: { targetId: string; itemId: string; decision: "accept" | "reject" }) => {
      if (!runId) {
        throw new Error("runId is required to submit decisions");
      }
      await evaluationReviewService.submitReviewerDecision({
        project_id: projectId,
        run_id: runId,
        target_id: input.targetId,
        item_id: input.itemId,
        schema_version_id: schemaVersionId,
        decision: input.decision,
      });
    },
  });

  const items = queueQuery.data?.items ?? [];

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">Review queue</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending review items.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1">Target</th>
              <th className="py-1">Item</th>
              <th className="py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={`${row.target_id}-${row.item_id}`} className="border-t">
                <td className="py-2">{row.target_id}</td>
                <td className="py-2">{row.item_id}</td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!runId}
                      onClick={() =>
                        decisionMutation.mutate({
                          targetId: row.target_id,
                          itemId: row.item_id,
                          decision: "accept",
                        })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!runId}
                      onClick={() =>
                        decisionMutation.mutate({
                          targetId: row.target_id,
                          itemId: row.item_id,
                          decision: "reject",
                        })
                      }
                    >
                      Reject
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      Edit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default UnifiedReviewQueueTable;
