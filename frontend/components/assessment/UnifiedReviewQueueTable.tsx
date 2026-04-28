import { Button } from "@/components/ui/button";
import { useCreateDecision, useRun } from "@/hooks/runs";

interface UnifiedReviewQueueTableProps {
  runId: string;
}

export function UnifiedReviewQueueTable({ runId }: UnifiedReviewQueueTableProps) {
  const runQuery = useRun(runId);
  const decisionMutation = useCreateDecision(runId);

  const proposals = runQuery.data?.proposals ?? [];
  const decisions = runQuery.data?.decisions ?? [];
  const decidedKeys = new Set(decisions.map((d) => `${d.instance_id}-${d.field_id}`));
  const pending = proposals.filter(
    (p) => !decidedKeys.has(`${p.instance_id}-${p.field_id}`),
  );

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">Review queue</h3>
      {runQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading run…</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending review items.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1">Instance</th>
              <th className="py-1">Field</th>
              <th className="py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((proposal) => (
              <tr key={proposal.id} className="border-t">
                <td className="py-2">{proposal.instance_id}</td>
                <td className="py-2">{proposal.field_id}</td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        decisionMutation.mutate({
                          instance_id: proposal.instance_id,
                          field_id: proposal.field_id,
                          decision: "accept_proposal",
                          proposal_record_id: proposal.id,
                        })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        decisionMutation.mutate({
                          instance_id: proposal.instance_id,
                          field_id: proposal.field_id,
                          decision: "reject",
                          proposal_record_id: proposal.id,
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
