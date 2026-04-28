/**
 * Consensus resolution panel — rendered when the active run is in
 * stage='consensus' and reviewers diverged on at least one (instance, field).
 *
 * Per divergent coord, the panel surfaces each reviewer's latest
 * decision with two resolution paths:
 *   1. select_existing — accept reviewer X's decision verbatim.
 *   2. manual_override — write a custom value with rationale (used by
 *      the arbitrator to publish something nobody picked).
 *
 * Once every divergent coord has a corresponding ConsensusDecision in
 * the run aggregate, "Finalize run" advances stage → finalized which
 * also flips status → completed and materializes the final published
 * state per coord.
 *
 * Stateless w.r.t. server data — relies entirely on `runDetail` and
 * `summary` (which is derived from `runDetail`). The parent re-fetches
 * the run after each mutation so progress reflects in real time.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Edit3, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import type {
  ConsensusDecisionResponse,
  ReviewerDecisionResponse,
  RunDetailResponse,
} from "@/hooks/runs/types";
import type { ReviewerSummary } from "@/hooks/runs/useReviewerSummary";

export interface ConsensusPanelProps {
  runDetail: RunDetailResponse;
  summary: ReviewerSummary;
  /** Pretty label per `${instance}::${field}` — caller resolves from
   * domains/sections; falls back to coord text when missing. */
  fieldLabelByCoord?: Record<string, string>;
  /** Pretty label per reviewer_id; falls back to a short UUID when missing. */
  reviewerLabelById?: Record<string, string>;
  /** Resolve via select_existing: accept reviewer X's decision verbatim. */
  onSelectExisting: (params: {
    instanceId: string;
    fieldId: string;
    decisionId: string;
    rationale?: string;
  }) => Promise<void> | void;
  /** Resolve via manual_override: write a custom value + rationale. */
  onManualOverride: (params: {
    instanceId: string;
    fieldId: string;
    value: unknown;
    rationale: string;
  }) => Promise<void> | void;
  /** Advance to finalized once all divergent coords are resolved. */
  onFinalize: () => Promise<void> | void;
  /** Disable interactive controls during inflight mutations. */
  isResolving?: boolean;
  isFinalizing?: boolean;
}

interface CoordRowProps {
  coordKey: string;
  fieldLabel: string;
  decisions: ReviewerDecisionResponse[];
  reviewerLabelById: Record<string, string>;
  resolved: ConsensusDecisionResponse | undefined;
  disabled: boolean;
  onSelectExisting: (decisionId: string) => Promise<void> | void;
  onManualOverride: (value: unknown, rationale: string) => Promise<void> | void;
}

function unwrap(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "value" in (raw as Record<string, unknown>)
  ) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function reviewerLabel(
  reviewerId: string,
  reviewerLabelById: Record<string, string>,
): string {
  return (
    reviewerLabelById[reviewerId] ??
    `Reviewer ${reviewerId.slice(0, 8)}…`
  );
}

function CoordRow({
  coordKey,
  fieldLabel,
  decisions,
  reviewerLabelById,
  resolved,
  disabled,
  onSelectExisting,
  onManualOverride,
}: CoordRowProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideRationale, setOverrideRationale] = useState("");

  const isResolved = !!resolved;

  return (
    <Card
      className={cn(
        "border-l-4",
        isResolved
          ? "border-l-emerald-500"
          : "border-l-amber-500",
      )}
      data-testid={`consensus-coord-${coordKey}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {isResolved ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
            <CardTitle className="text-sm font-semibold">{fieldLabel}</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            {decisions.length} reviewer{decisions.length === 1 ? "" : "s"} disagreed.
          </p>
        </div>
        {isResolved ? (
          <Badge
            variant="outline"
            className="border-emerald-300 bg-emerald-50 text-emerald-800"
            data-testid={`consensus-coord-resolved-${coordKey}`}
          >
            <ShieldCheck className="mr-1 h-3 w-3" />
            Resolved · {resolved.mode}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          {decisions.map((d) => {
            const value = unwrap(d.value);
            const isReject = d.decision === "reject";
            return (
              <div
                key={d.id}
                className={cn(
                  "rounded border p-3 text-sm",
                  isReject
                    ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950"
                    : "border-border/60",
                )}
                data-testid={`consensus-decision-${d.id}`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {reviewerLabel(d.reviewer_id, reviewerLabelById)}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {d.decision}
                  </Badge>
                </div>
                <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {isReject ? "(rejected)" : JSON.stringify(value, null, 2)}
                </pre>
                {!isResolved ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 text-xs"
                    disabled={disabled || isReject}
                    onClick={() => void onSelectExisting(d.id)}
                    data-testid={`consensus-accept-${d.id}`}
                  >
                    Use this value
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>

        {!isResolved ? (
          overrideOpen ? (
            <div
              className="space-y-2 rounded border border-dashed p-3"
              data-testid={`consensus-override-${coordKey}`}
            >
              <Label htmlFor={`override-value-${coordKey}`} className="text-xs">
                Custom value (JSON; use a string for free-text fields)
              </Label>
              <Input
                id={`override-value-${coordKey}`}
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                placeholder='"Low" or {"text": "..."}'
                disabled={disabled}
              />
              <Label
                htmlFor={`override-rationale-${coordKey}`}
                className="text-xs"
              >
                Rationale (required)
              </Label>
              <Textarea
                id={`override-rationale-${coordKey}`}
                value={overrideRationale}
                onChange={(e) => setOverrideRationale(e.target.value)}
                placeholder="Why publish a value none of the reviewers picked?"
                rows={2}
                disabled={disabled}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOverrideOpen(false);
                    setOverrideValue("");
                    setOverrideRationale("");
                  }}
                  disabled={disabled}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={
                    disabled ||
                    overrideValue.trim() === "" ||
                    overrideRationale.trim() === ""
                  }
                  onClick={async () => {
                    let parsed: unknown;
                    try {
                      parsed = JSON.parse(overrideValue);
                    } catch {
                      parsed = overrideValue;
                    }
                    await onManualOverride(parsed, overrideRationale.trim());
                    setOverrideOpen(false);
                    setOverrideValue("");
                    setOverrideRationale("");
                  }}
                  data-testid={`consensus-override-submit-${coordKey}`}
                >
                  Publish override
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOverrideOpen(true)}
              disabled={disabled}
              data-testid={`consensus-override-toggle-${coordKey}`}
            >
              <Edit3 className="mr-1 h-3 w-3" />
              Override with custom value
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ConsensusPanel({
  runDetail,
  summary,
  fieldLabelByCoord = {},
  reviewerLabelById = {},
  onSelectExisting,
  onManualOverride,
  onFinalize,
  isResolving = false,
  isFinalizing = false,
}: ConsensusPanelProps) {
  const resolvedByCoord = useMemo(() => {
    const m = new Map<string, ConsensusDecisionResponse>();
    for (const c of runDetail.consensus_decisions) {
      m.set(`${c.instance_id}::${c.field_id}`, c);
    }
    return m;
  }, [runDetail.consensus_decisions]);

  const divergentList = useMemo(
    () => [...summary.divergentCoords],
    [summary.divergentCoords],
  );

  const resolvedCount = divergentList.filter((c) => resolvedByCoord.has(c)).length;
  const totalCount = divergentList.length;
  const allResolved = totalCount > 0 && resolvedCount === totalCount;
  const progressPct =
    totalCount === 0 ? 100 : Math.round((resolvedCount / totalCount) * 100);

  if (totalCount === 0) {
    // Reviewers all agreed; nothing to resolve here. Surface a fast-path.
    return (
      <div
        className="m-4 rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
        data-testid="consensus-empty"
      >
        <p className="font-medium">No conflicts to resolve.</p>
        <p className="mt-1">
          Every reviewer agreed on every field. You can finalize the run.
        </p>
        <Button
          size="sm"
          className="mt-3"
          onClick={() => void onFinalize()}
          disabled={isFinalizing}
          data-testid="consensus-finalize-empty"
        >
          {isFinalizing ? "Finalizing…" : "Finalize run"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" data-testid="consensus-panel">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Resolve divergence</h2>
            <p className="text-xs text-muted-foreground">
              {resolvedCount}/{totalCount} field
              {totalCount === 1 ? "" : "s"} resolved.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => void onFinalize()}
            disabled={!allResolved || isFinalizing}
            data-testid="consensus-finalize-button"
          >
            {isFinalizing
              ? "Finalizing…"
              : allResolved
                ? "Finalize run"
                : `${totalCount - resolvedCount} left`}
          </Button>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      <div className="space-y-3">
        {divergentList.map((coordKey) => {
          const decisions = summary.decisionsByCoord.get(coordKey) ?? [];
          const [instanceId, fieldId] = coordKey.split("::");
          const fieldLabel = fieldLabelByCoord[coordKey] ?? coordKey;
          const resolved = resolvedByCoord.get(coordKey);
          return (
            <CoordRow
              key={coordKey}
              coordKey={coordKey}
              fieldLabel={fieldLabel}
              decisions={decisions}
              reviewerLabelById={reviewerLabelById}
              resolved={resolved}
              disabled={isResolving}
              onSelectExisting={async (decisionId) => {
                await onSelectExisting({
                  instanceId,
                  fieldId,
                  decisionId,
                });
              }}
              onManualOverride={async (value, rationale) => {
                await onManualOverride({
                  instanceId,
                  fieldId,
                  value,
                  rationale,
                });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
