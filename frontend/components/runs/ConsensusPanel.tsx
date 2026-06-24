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
import { ReviewerAvatarStack } from "@/components/runs/ReviewerAvatarStack";
import { classifyReconciliation } from "@/lib/runs/reconciliation";
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
   * Every required template coordKey (`${instance}::${field}`). Drives the
   * "Needs attention" required-gap rows and the finalize gate. Caller computes
   * it from the template; pass `[]` when none are required.
   */
  requiredCoords: string[];
  /**
   * Whether the current viewer may see peers' values. Threaded into each row;
   * reserved for per-row reveal gating.
   */
  peersRevealed: boolean;
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
  variant: "conflict" | "single_filler" | "required_gap";
  decisions: ReviewerDecisionResponse[];
  reviewerLabelById: Record<string, string>;
  avatarById: Record<string, string | null>;
  resolved: ConsensusDecisionResponse | undefined;
  peersRevealed: boolean;
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
  variant,
  decisions,
  reviewerLabelById,
  avatarById,
  resolved,
  peersRevealed,
  disabled,
  onSelectExisting,
  onManualOverride,
}: CoordRowProps) {
  const [editing, setEditing] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(variant === "required_gap");
  const [overrideValue, setOverrideValue] = useState("");
  const [overrideRationale, setOverrideRationale] = useState("");

  const isResolved = !!resolved;

  const resolvedReviewerName =
    resolved?.mode === "select_existing"
      ? (() => {
          const d = decisions.find((x) => x.id === resolved.selected_decision_id);
          return d ? reviewerLabel(d.reviewer_id, reviewerLabelById) : null;
        })()
      : null;
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
            {variant === "required_gap" ? (
              <Badge
                variant="outline"
                className="border-warning/30 bg-warning/10 text-warning"
                data-testid={`consensus-badge-required-gap-${coordKey}`}
              >
                {t("consensus", "badgeRequiredGap")}
              </Badge>
            ) : null}
            {variant === "single_filler" ? (
              <Badge
                variant="outline"
                className="border-border/60 text-muted-foreground"
                data-testid={`consensus-badge-single-filler-${coordKey}`}
              >
                {t("consensus", "badgeSingleFiller")}
              </Badge>
            ) : null}
          </div>
          {variant === "conflict" && decisions.length > 0 ? (
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
          ) : null}
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
        {isResolved && !editing ? (
          <div
            className="space-y-2 rounded border border-success/30 bg-success/5 p-3 text-sm"
            data-testid={`consensus-resolved-${coordKey}`}
          >
            <div className="text-xs font-medium text-muted-foreground">
              {t("consensus", "resolvedValueLabel")} ·{" "}
              {resolved!.mode === "manual_override"
                ? t("consensus", "resolvedCustom")
                : peersRevealed && resolvedReviewerName
                  ? t("consensus", "resolvedFromReviewer").replace("{{reviewer}}", resolvedReviewerName)
                  : t("consensus", "resolvedCustom")}
            </div>
            <pre className="whitespace-pre-wrap break-words text-xs">
              {(() => {
                const v = unwrap(resolved!.value);
                return typeof v === "string" ? v : JSON.stringify(v, null, 2);
              })()}
            </pre>
            {resolved!.rationale ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{t("consensus", "resolvedRationaleLabel")}:</span>{" "}
                <span>{resolved!.rationale}</span>
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setEditing(true);
                if (resolved!.mode === "manual_override") {
                  setOverrideOpen(true);
                  const v = unwrap(resolved!.value);
                  setOverrideValue(typeof v === "string" ? v : JSON.stringify(v));
                  setOverrideRationale(resolved!.rationale ?? "");
                }
              }}
            >
              {t("consensus", "change")}
            </Button>
          </div>
        ) : (
          <>
            {isResolved && editing ? (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setEditing(false);
                    setOverrideOpen(false);
                    setOverrideValue("");
                    setOverrideRationale("");
                  }}
                  disabled={disabled}
                  data-testid={`consensus-cancel-edit-${coordKey}`}
                >
                  {t("consensus", "cancel")}
                </Button>
              </div>
            ) : null}
            {decisions.length > 0 ? (
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
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {isReject
                          ? t("consensus", "panelRejected")
                          : JSON.stringify(value, null, 2)}
                      </pre>
                      {(!isResolved || editing) ? (
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
            ) : null}

            {overrideOpen ? (
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
                      setEditing(false);
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
                      setEditing(false);
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
            )}
          </>
        )}
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
  requiredCoords,
  peersRevealed,
  showFinalize = true,
}: ConsensusPanelProps) {
  // Newest consensus decision wins per coord (the run aggregate can carry more
  // than one if an arbitrator re-resolved a field).
  const resolvedByCoord = (() => {
    const m = new Map<string, ConsensusDecisionResponse>();
    for (const c of runDetail.consensus_decisions) {
      const key = `${c.instance_id}::${c.field_id}`;
      const prev = m.get(key);
      if (!prev || prev.created_at < c.created_at) m.set(key, c);
    }
    return m;
  })();

  const publishedCoords = new Set(
    runDetail.published_states.map((p) => `${p.instance_id}::${p.field_id}`),
  );
  const decisionCountByCoord = new Map(
    [...summary.decisionsByCoord].map(([k, v]) => [k, v.length]),
  );
  const buckets = classifyReconciliation({
    divergentCoords: summary.divergentCoords,
    decisionCountByCoord,
    participantCount: summary.reviewers.length,
    requiredCoords,
    publishedCoords,
  });
  const nothing =
    buckets.conflicts.length === 0 &&
    buckets.requiredGaps.length === 0 &&
    buckets.singleFiller.length === 0;

  const renderRow = (
    coordKey: string,
    variant: "conflict" | "single_filler" | "required_gap",
  ) => {
    const decisions = summary.decisionsByCoord.get(coordKey) ?? [];
    const [instanceId, fieldId] = coordKey.split("::");
    const fieldLabel = fieldLabelByCoord[coordKey] ?? coordKey;
    return (
      <CoordRow
        key={coordKey}
        coordKey={coordKey}
        fieldLabel={fieldLabel}
        variant={variant}
        decisions={decisions}
        reviewerLabelById={reviewerLabelById}
        avatarById={avatarById}
        resolved={resolvedByCoord.get(coordKey)}
        peersRevealed={peersRevealed}
        disabled={isResolving}
        onSelectExisting={async (decisionId) =>
          onSelectExisting({ instanceId, fieldId, decisionId })
        }
        onManualOverride={async (value, rationale) =>
          onManualOverride({ instanceId, fieldId, value, rationale })
        }
      />
    );
  };

  // QA owns the in-panel finalize bar (extraction's header owns it instead).
  // Enabled only when no conflict is unresolved and no required gap remains.
  const conflictsResolved = buckets.conflicts.every((c) =>
    resolvedByCoord.has(c),
  );
  const canFinalize =
    conflictsResolved &&
    buckets.requiredGaps.length === 0 &&
    isComplete &&
    runDetail.consensus_decisions.length > 0;

  return (
    <div className="space-y-4 p-4" data-testid="consensus-panel">
      {showFinalize ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            {t("consensus", "panelResolveTitle")}
          </h2>
          <Button
            size="sm"
            onClick={() => void onFinalize()}
            disabled={!canFinalize || isFinalizing}
            data-testid="consensus-finalize-button"
          >
            {isFinalizing
              ? t("consensus", "panelFinalizing")
              : t("consensus", "panelFinalize")}
          </Button>
        </div>
      ) : null}

      {nothing && !showFinalize ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="consensus-nothing"
        >
          {t("consensus", "nothingToReconcile")}
        </p>
      ) : null}

      {buckets.conflicts.length > 0 ? (
        <section className="space-y-3" data-testid="consensus-section-conflicts">
          <SectionHeading
            title={t("consensus", "sectionConflictsTitle")}
            desc={t("consensus", "sectionConflictsDesc")}
            count={buckets.conflicts.length}
          />
          {buckets.conflicts.map((coordKey) => renderRow(coordKey, "conflict"))}
        </section>
      ) : null}

      {buckets.requiredGaps.length + buckets.singleFiller.length > 0 ? (
        <section className="space-y-3" data-testid="consensus-section-attention">
          <SectionHeading
            title={t("consensus", "sectionAttentionTitle")}
            desc={t("consensus", "sectionAttentionDesc")}
            count={buckets.requiredGaps.length + buckets.singleFiller.length}
          />
          {buckets.requiredGaps.map((coordKey) =>
            renderRow(coordKey, "required_gap"),
          )}
          {buckets.singleFiller.map((coordKey) =>
            renderRow(coordKey, "single_filler"),
          )}
        </section>
      ) : null}

      {buckets.agreements.length > 0 ? (
        <AgreedSummary
          coords={buckets.agreements}
          fieldLabelByCoord={fieldLabelByCoord}
        />
      ) : null}
    </div>
  );
}

function SectionHeading({
  title,
  desc,
  count,
}: {
  title: string;
  desc: string;
  count: number;
}) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-sm font-semibold">
        {title} <span className="text-muted-foreground">· {count}</span>
      </h3>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function AgreedSummary({
  coords,
  fieldLabelByCoord,
}: {
  coords: string[];
  fieldLabelByCoord: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className="rounded border border-border/60 p-3"
      data-testid="consensus-section-agreed"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>
          {(coords.length === 1
            ? t("consensus", "sectionAgreedHintOne")
            : t("consensus", "sectionAgreedHintOther")
          ).replace("{{count}}", String(coords.length))}
        </span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {coords.map((c) => (
            <li key={c}>{fieldLabelByCoord[c] ?? c}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
