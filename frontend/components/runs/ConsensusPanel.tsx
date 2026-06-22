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
 * the run aggregate, finalizing advances stage → finalized which
 * also flips status → completed and materializes the final published
 * state per coord.
 *
 * Stateless w.r.t. server data — relies entirely on `runDetail` and
 * `summary` (which is derived from `runDetail`). The parent re-fetches
 * the run after each mutation so progress reflects in real time.
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Edit3, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { ReviewerAvatarStack } from "@/components/runs/ReviewerAvatarStack";
import { cn } from "@/lib/utils";
import { t } from "@/lib/copy";

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
  /** Avatar URL per reviewer_id (nullable). Drives the avatar stack. */
  avatarById?: Record<string, string | null>;
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
  /**
   * Whether every required field carries a resolved value — the canonical
   * completeness metric the header uses. Gates the no-divergence fast-path
   * so the panel never offers a finalize the backend would reject (ADR 0009).
   */
  isComplete?: boolean;
  /** Disable interactive controls during inflight mutations. */
  isResolving?: boolean;
  isFinalizing?: boolean;
  /**
   * Evaluate-all mode (extraction): the full template-ordered coord list
   * (`${instance}::${field}`) to render — agreed coords included, not just
   * divergent. When omitted (QA), the panel renders divergent-only (legacy).
   */
  evaluateAllCoords?: string[];
  /**
   * Render the in-panel finalize button. Default true (QA owns finalize here).
   * Extraction sets false — the header PrimaryAction owns "Approve & finalize"
   * (one source of truth, spec I6).
   */
  showFinalize?: boolean;
}

interface CoordRowProps {
  coordKey: string;
  fieldLabel: string;
  decisions: ReviewerDecisionResponse[];
  reviewerLabelById: Record<string, string>;
  avatarById: Record<string, string | null>;
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
    t("consensus", "panelReviewerFallback").replace(
      "{{id}}",
      reviewerId.slice(0, 8),
    )
  );
}

function CoordRow({
  coordKey,
  fieldLabel,
  decisions,
  reviewerLabelById,
  avatarById,
  resolved,
  disabled,
  onSelectExisting,
  onManualOverride,
}: CoordRowProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideRationale, setOverrideRationale] = useState("");

  const isResolved = !!resolved;
  const stack = decisions.map((d) => ({
    id: d.reviewer_id,
    name: reviewerLabel(d.reviewer_id, reviewerLabelById),
    avatarUrl: avatarById[d.reviewer_id] ?? null,
  }));

  return (
    <Card
      className={cn(
        "border-l-4",
        isResolved
          ? "border-l-success"
          : "border-l-warning",
      )}
      data-testid={`consensus-coord-${coordKey}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {isResolved ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" />
            )}
            <CardTitle className="text-sm font-semibold">{fieldLabel}</CardTitle>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ReviewerAvatarStack
              reviewers={stack}
              testId={`consensus-coord-avatar-${coordKey}`}
            />
            <span>
              {(decisions.length === 1
                ? t("consensus", "panelReviewerDisagreedOne")
                : t("consensus", "panelReviewersDisagreedOther")
              ).replace("{{count}}", String(decisions.length))}
            </span>
          </div>
        </div>
        {isResolved ? (
          <Badge
            variant="outline"
            className="border-success/30 bg-success/10 text-success"
            data-testid={`consensus-coord-resolved-${coordKey}`}
          >
            <ShieldCheck className="mr-1 h-3 w-3" />
            {t("consensus", "panelResolved")} · {resolved.mode}
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
                    ? "border-destructive/30 bg-destructive/5"
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
                  {isReject
                    ? t("consensus", "panelRejected")
                    : JSON.stringify(value, null, 2)}
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
                    {t("consensus", "panelUseThisValue")}
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
                {t("consensus", "panelCustomValueLabel")}
              </Label>
              <Input
                id={`override-value-${coordKey}`}
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                placeholder={t("consensus", "panelCustomValuePlaceholder")}
                disabled={disabled}
              />
              <Label
                htmlFor={`override-rationale-${coordKey}`}
                className="text-xs"
              >
                {t("consensus", "panelRationaleLabel")}
              </Label>
              <Textarea
                id={`override-rationale-${coordKey}`}
                value={overrideRationale}
                onChange={(e) => setOverrideRationale(e.target.value)}
                placeholder={t("consensus", "panelRationalePlaceholder")}
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
                  {t("consensus", "cancel")}
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
                  {t("consensus", "panelPublishOverride")}
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
              {t("consensus", "panelOverrideWithCustom")}
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
  avatarById = {},
  onSelectExisting,
  onManualOverride,
  onFinalize,
  isComplete = false,
  isResolving = false,
  isFinalizing = false,
  evaluateAllCoords,
  showFinalize = true,
}: ConsensusPanelProps) {
  const resolvedByCoord = (() => {
    const m = new Map<string, ConsensusDecisionResponse>();
    for (const c of runDetail.consensus_decisions) {
      m.set(`${c.instance_id}::${c.field_id}`, c);
    }
    return m;
  })();

  const divergentList = [...summary.divergentCoords];
  // Evaluate-all (extraction): render every coord; QA renders divergent-only.
  const evaluateAll = evaluateAllCoords != null;
  const coordList = evaluateAll ? evaluateAllCoords : divergentList;

  // Progress always tracks the DIVERGENT coords (the ones needing arbitration),
  // independent of which coords are rendered.
  const resolvedCount = divergentList.filter((c) => resolvedByCoord.has(c)).length;
  const totalCount = divergentList.length;
  const allResolved = totalCount > 0 && resolvedCount === totalCount;
  const progressPct =
    totalCount === 0 ? 100 : Math.round((resolvedCount / totalCount) * 100);

  // No-divergence fast-path applies only to the divergent-only view (QA). In
  // evaluate-all (extraction) the full grid renders even with zero divergence.
  if (!evaluateAll && totalCount === 0) {
    // No divergent coords to resolve. But "no divergence" is NOT the same as
    // "ready to publish": the run still needs every required field filled
    // (ADR 0009) and at least one consensus decision (EmptyFinalizeError).
    // Only offer finalize when both hold, so we never trigger a backend
    // rejection the old copy ("agreed on every field") implied couldn't happen.
    const hasConsensus = runDetail.consensus_decisions.length > 0;
    const canFinalize = isComplete && hasConsensus;
    const blockedReason = !isComplete
      ? t("consensus", "panelBlockedIncomplete")
      : t("consensus", "panelBlockedNoDecision");
    return (
      <div
        className={cn(
          "m-4 rounded border p-4 text-sm text-foreground",
          canFinalize
            ? "border-success/30 bg-success/10"
            : "border-warning/30 bg-warning/10",
        )}
        data-testid="consensus-empty"
      >
        <p className="font-medium">{t("consensus", "panelNoConflictsTitle")}</p>
        <p className="mt-1">
          {canFinalize
            ? t("consensus", "panelReadyToFinalize")
            : blockedReason}
        </p>
        <Button
          size="sm"
          className="mt-3"
          onClick={() => void onFinalize()}
          disabled={!canFinalize || isFinalizing}
          data-testid="consensus-finalize-empty"
        >
          {isFinalizing
            ? t("consensus", "panelFinalizing")
            : t("consensus", "panelFinalize")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" data-testid="consensus-panel">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {evaluateAll
                ? t("consensus", "panelEvaluateAllTitle")
                : t("consensus", "panelResolveTitle")}
            </h2>
            {totalCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {(totalCount === 1
                  ? t("consensus", "panelFieldsResolvedOne")
                  : t("consensus", "panelFieldsResolvedOther")
                )
                  .replace("{{resolved}}", String(resolvedCount))
                  .replace("{{total}}", String(totalCount))}
              </p>
            ) : null}
          </div>
          {showFinalize ? (
            <Button
              size="sm"
              onClick={() => void onFinalize()}
              disabled={!allResolved || isFinalizing}
              data-testid="consensus-finalize-button"
            >
              {isFinalizing
                ? t("consensus", "panelFinalizing")
                : allResolved
                  ? t("consensus", "panelFinalize")
                  : t("consensus", "panelLeft").replace(
                      "{{count}}",
                      String(totalCount - resolvedCount),
                    )}
            </Button>
          ) : null}
        </div>
        {totalCount > 0 ? <Progress value={progressPct} className="h-2" /> : null}
      </div>

      <div className="space-y-3">
        {coordList.map((coordKey) => {
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
              avatarById={avatarById}
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
