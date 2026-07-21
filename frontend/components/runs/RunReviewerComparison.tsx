/**
 * Shared side-by-side reviewer comparison, driven entirely by `runDetail`.
 *
 * Used by BOTH the extraction and QA screens. Rows are `(instance, field)`
 * coordinates grouped by entity_type (section / QA domain) → instance; columns
 * are one per reviewer who has a decision on the run (plus "You" in read-only
 * mode). The peer data comes from `reviewerSummary.decisionsByCoord` (already
 * server-blinded via the typed `/runs/{id}/view`), so when the caller is blind
 * there are simply no peer columns — no separate fetch, no direct Supabase read.
 *
 * Two modes:
 *   · **read-only** (no `resolution` prop) — the compare surface for the
 *     extract / assess stages: a "You" column plus reviewer columns, no actions.
 *   · **resolve** (`resolution` prop) — the consensus stage: no "You" column, a
 *     trailing "Consensus" column, filter chips, per-row adopt ("Use this
 *     value") + a typed override editor, and a resolved-value summary. Still
 *     presentational — every mutation is a caller callback.
 *
 * Coordinate-key contract: peer decisions are keyed `${instanceId}::${fieldId}`
 * (double colon, from `useReviewerSummary`); the caller's own values are keyed
 * `${instanceId}_${fieldId}` (single underscore, the form's map). This component
 * is the single place that bridges the two.
 */

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ConsensusOverrideEditor } from '@/components/runs/ConsensusOverrideEditor';
import { ReviewerAITrace } from '@/components/runs/ReviewerAITrace';
import { FieldAITrace } from '@/components/runs/FieldAITrace';
import type { FieldValueEditorField } from '@/components/extraction/FieldValueEditor';
import type { CoordStatus, ResolvedConsensusLike } from '@/lib/runs/reconciliation';
import type { ReviewerDecisionResponse } from '@/hooks/runs/types';
import { buildPeerAdoptionMap } from '@/lib/runs/adoption';
import type { AISuggestion, AISuggestionHistoryItem } from '@/types/ai-extraction';
import { t } from '@/lib/copy';
import { absentReasonLabel } from '@/lib/extraction/absentReasonLabel';
import { unwrapValueEnvelope } from '@/lib/extraction/valueSemantics';

export interface ComparisonField {
  id: string;
  label?: string | null;
  name?: string | null;
  // Editor-relevant template attributes (present when the caller has them;
  // absent ⇒ the resolve-mode override editor falls back to a text input).
  field_type?: string;
  allowed_values?: unknown;
  unit?: string | null;
  allowed_units?: string[] | null;
  allow_other?: boolean;
  other_label?: string | null;
  other_placeholder?: string | null;
}

export interface ComparisonEntityType {
  id: string;
  label?: string | null;
  name?: string | null;
  fields: ComparisonField[];
}

export interface ComparisonInstance {
  id: string;
  entity_type_id: string;
  parent_instance_id?: string | null;
  label?: string | null;
}

/**
 * Consensus AI-trace wiring (spec 2026-07-09 D2): everything the per-field
 * (`FieldAITrace`) and per-cell (`ReviewerAITrace`) traces need. A single
 * top-level channel on `RunReviewerComparison` — passed UNCONDITIONALLY by the
 * consensus panel (both resolve and read-only surfaces consume it), never
 * nested under `resolution`. Adding this while leaving a second copy on
 * `resolution` would be the parallel-path anti-pattern — so `resolution` no
 * longer carries a trace.
 */
export interface ConsensusTraceContext {
  articleId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  /**
   * Screen's suggestions map keyed `${instanceId}_${fieldId}` — the
   * AI-existence signal. `null` while suggestions are loading/failed so a
   * transient error can't mislabel a coord as having no AI.
   */
  aiSuggestions: Record<string, AISuggestion> | null;
  /**
   * Whether peer identity may be revealed (`peers_revealed || canSeeOthers`).
   * When false, field-level cross-marks collapse to the caller's own (server
   * already strips peer rows — this is the second, fail-closed layer for blind
   * review, matching the ran-by header's gate).
   */
  showPeerIdentity: boolean;
  /** The caller's own reviewer id — the mark kept when peer identity is hidden. */
  currentUserId: string | null;
}

/**
 * Resolve-mode wiring. Absent ⇒ read-only compare (unchanged). The status/
 * resolved maps come from `deriveConsensusResolution`; the callbacks are the
 * page's consensus mutations (which envelope the value + refetch).
 */
export interface ComparisonResolution {
  statusByCoord: ReadonlyMap<string, CoordStatus>;
  resolvedByCoord: ReadonlyMap<string, ResolvedConsensusLike>;
  needsAttentionCount: number;
  resolvedCount: number;
  disabled: boolean;
  peersRevealed: boolean;
  onSelectExisting: (p: {
    instanceId: string;
    fieldId: string;
    decisionId: string;
  }) => Promise<void> | void;
  /** value = form-shaped editor output or the flat marker (caller envelopes it). */
  onManualOverride: (p: {
    instanceId: string;
    fieldId: string;
    value: unknown;
    rationale: string;
  }) => Promise<void> | void;
}

export interface RunReviewerComparisonProps {
  /** `${instanceId}::${fieldId}` → latest decision per distinct reviewer. */
  decisionsByCoord: Map<string, ReviewerDecisionResponse[]>;
  entityTypes: ComparisonEntityType[];
  instances: ComparisonInstance[];
  /** Caller's own values, keyed `${instanceId}_${fieldId}`. Read-only mode only. */
  ownValues: Record<string, unknown>;
  reviewerLabelById: Record<string, string>;
  reviewerAvatarById: Record<string, string | null | undefined>;
  /** When present, the surface renders in resolve mode (consensus stage). */
  resolution?: ComparisonResolution;
  /**
   * Consensus AI-trace channel (D2). Passed unconditionally by the consensus
   * panel; drives the per-field trace on BOTH the resolve and read-only
   * branches, plus the retained per-cell trace in resolve mode. Omitted by the
   * extract/assess compare mounts, which keep no trace affordances.
   */
  aiTrace?: ConsensusTraceContext;
}

const peerKey = (instanceId: string, fieldId: string) => `${instanceId}::${fieldId}`;
const ownKey = (instanceId: string, fieldId: string) => `${instanceId}_${fieldId}`;

/**
 * Build the per-field trace slot (D1) for one coord. Renders the endorsement-
 * neutral `FieldAITrace` iff the coord has an AI proposal; silent otherwise.
 * Field-level cross-marks include the caller's own adoption (D6) and are gated
 * to self when peer identity is hidden (blind fail-closed).
 */
function fieldTraceSlot(
  aiTrace: ConsensusTraceContext | undefined,
  instanceId: string,
  field: ComparisonField,
  peers: ReviewerDecisionResponse[],
  reviewerLabelById: Record<string, string>,
): React.ReactNode {
  if (!aiTrace) return null;
  const key = ownKey(instanceId, field.id);
  const hasAISuggestion = aiTrace.aiSuggestions ? !!aiTrace.aiSuggestions[key] : null;
  // Fail fast before building the peer-adoption map: most coords have no AI
  // proposal, and FieldAITrace renders nothing for them anyway.
  if (hasAISuggestion !== true) return null;
  const marks = buildPeerAdoptionMap(
    peers,
    reviewerLabelById,
    aiTrace.showPeerIdentity ? undefined : { onlyReviewerId: aiTrace.currentUserId },
  );
  return (
    <FieldAITrace
      instanceId={instanceId}
      fieldId={field.id}
      field={field}
      articleId={aiTrace.articleId}
      getHistory={aiTrace.getHistory}
      adoptionByProposalId={marks}
      hasAISuggestion={hasAISuggestion}
    />
  );
}

/**
 * Shared field-label cell (D4) for both the read-only and resolve branches.
 * The eyebrow + label markup is byte-identical to the pre-refactor cells when
 * no `traceSlot` is passed (extract/assess mounts stay unchanged); the trace
 * icon trails the label text only (never the eyebrow), and the label keeps
 * `min-w-0 truncate` alongside the shrink-0 icon (D9).
 */
function FieldLabelCell({
  entityLabel,
  fieldLabel,
  traceSlot,
}: {
  entityLabel: string;
  fieldLabel: string;
  traceSlot?: React.ReactNode;
}) {
  return (
    <th scope="row" className="py-2 pr-4 text-left font-normal text-muted-foreground">
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/70">
        {entityLabel}
      </span>
      {traceSlot ? (
        <span className="flex items-center gap-1">
          <span className="min-w-0 truncate">{fieldLabel}</span>
          {traceSlot}
        </span>
      ) : (
        fieldLabel
      )}
    </th>
  );
}

function displayValue(raw: unknown): string {
  // A coded disposition marker renders as its human label ("No information"), so a
  // disposition divergence reads legibly instead of two identical-looking blanks
  // (ADR-0016 Phase 4). The sibling `absent_reason` is otherwise dropped by the peel.
  const label = absentReasonLabel(raw);
  if (label !== null) return label;
  const v = unwrapValueEnvelope(raw);
  if (v === null || v === undefined || v === '') return t('shared', 'compareNoValue');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function toEditorField(field: ComparisonField): FieldValueEditorField {
  return {
    id: field.id,
    label: field.label ?? field.name ?? field.id,
    field_type: field.field_type ?? 'text',
    allowed_values: field.allowed_values,
    unit: field.unit,
    allowed_units: field.allowed_units,
    allow_other: field.allow_other,
    other_label: field.other_label,
    other_placeholder: field.other_placeholder,
  };
}

const STATUS_CLASS: Record<Exclude<CoordStatus, 'resolved'>, string> = {
  conflict: 'border-warning/30 bg-warning/10 text-warning',
  required_gap: 'border-warning/30 bg-warning/10 text-warning',
  single_filler: 'border-border/60 text-muted-foreground',
  agreed: 'border-success/30 bg-success/10 text-success',
};

function statusBadgeLabel(status: Exclude<CoordStatus, 'resolved'>): string {
  switch (status) {
    case 'conflict':
      return t('consensus', 'statusConflict');
    case 'required_gap':
      return t('consensus', 'badgeRequiredGap');
    case 'single_filler':
      return t('consensus', 'badgeSingleFiller');
    case 'agreed':
      return t('consensus', 'statusAgreed');
  }
}

export function RunReviewerComparison({
  decisionsByCoord,
  entityTypes,
  instances,
  ownValues,
  reviewerLabelById,
  reviewerAvatarById,
  resolution,
  aiTrace,
}: RunReviewerComparisonProps) {
  const [filter, setFilter] = useState<'attention' | 'all' | 'resolved'>('attention');

  // Columns = distinct reviewers who have any decision on the run (sorted for
  // stable order). Empty ⇒ caller is blind / nobody else decided.
  const reviewerIds = [
    ...new Set([...decisionsByCoord.values()].flat().map((d) => d.reviewer_id)),
  ].sort();

  // Read-only mode with no peers: nothing to compare — UNLESS a trace context
  // is present, in which case a non-resolver/viewer at consensus must still see
  // the per-field AI trace on the field rows (the feature's core justification).
  // In resolve mode we always render (required gaps must show on a solo run).
  if (!resolution && !aiTrace && reviewerIds.length === 0) {
    return (
      <div className="p-8 text-center" data-testid="run-reviewer-comparison-empty">
        <p className="text-sm font-medium text-foreground">{t('shared', 'compareNoPeers')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('shared', 'compareNoPeersDesc')}</p>
      </div>
    );
  }

  const instancesByEntityType = new Map<string, ComparisonInstance[]>();
  for (const inst of instances) {
    const list = instancesByEntityType.get(inst.entity_type_id) ?? [];
    list.push(inst);
    instancesByEntityType.set(inst.entity_type_id, list);
  }

  if (resolution) {
    return (
      <ResolveTable
        decisionsByCoord={decisionsByCoord}
        entityTypes={entityTypes}
        instancesByEntityType={instancesByEntityType}
        reviewerIds={reviewerIds}
        reviewerLabelById={reviewerLabelById}
        reviewerAvatarById={reviewerAvatarById}
        resolution={resolution}
        aiTrace={aiTrace}
        filter={filter}
        setFilter={setFilter}
      />
    );
  }

  return (
    // TooltipProvider (renders no DOM — pure context) so the per-field trace's
    // tooltip works in the read-only branch too; harmless when no trace mounts.
    <TooltipProvider delayDuration={300}>
    <div className="overflow-x-auto" data-testid="run-reviewer-comparison">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left">
            <th className="py-2 pr-4 font-medium text-muted-foreground">{t('shared', 'fieldLabel')}</th>
            <th className="px-3 py-2 font-medium">{t('shared', 'youLabel')}</th>
            {reviewerIds.map((rid) => (
              <th key={rid} className="px-3 py-2 font-medium">
                <span className="flex items-center gap-1.5">
                  {reviewerAvatarById[rid] ? (
                    <img src={reviewerAvatarById[rid] as string} alt="" className="h-4 w-4 rounded-full" />
                  ) : null}
                  {reviewerLabelById[rid] ?? rid}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entityTypes.map((et) =>
            (instancesByEntityType.get(et.id) ?? []).map((inst) =>
              et.fields.map((field) => {
                const peers = decisionsByCoord.get(peerKey(inst.id, field.id)) ?? [];
                const fieldLabel = field.label ?? field.name ?? field.id;
                const entityLabel =
                  (et.label ?? et.name ?? '') + (inst.label ? ` · ${inst.label}` : '');
                return (
                  <tr
                    key={`${inst.id}_${field.id}`}
                    className="border-b border-border/30 align-top"
                  >
                    <FieldLabelCell
                      entityLabel={entityLabel}
                      fieldLabel={fieldLabel}
                      traceSlot={fieldTraceSlot(aiTrace, inst.id, field, peers, reviewerLabelById)}
                    />
                    <td className="px-3 py-2">{displayValue(ownValues[ownKey(inst.id, field.id)])}</td>
                    {reviewerIds.map((rid) => {
                      const decision = peers.find((d) => d.reviewer_id === rid);
                      return (
                        <td key={rid} className="px-3 py-2">
                          {decision?.decision === 'reject' ? (
                            <span className="text-xs text-muted-foreground italic">
                              {t('shared', 'compareRejected')}
                            </span>
                          ) : decision ? (
                            displayValue(decision.value)
                          ) : (
                            t('shared', 'compareNoValue')
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
            ),
          )}
        </tbody>
      </table>
    </div>
    </TooltipProvider>
  );
}

interface FlatRow {
  coordKey: string;
  entityLabel: string;
  fieldLabel: string;
  instanceId: string;
  field: ComparisonField;
}

function ResolveTable({
  decisionsByCoord,
  entityTypes,
  instancesByEntityType,
  reviewerIds,
  reviewerLabelById,
  reviewerAvatarById,
  resolution,
  aiTrace,
  filter,
  setFilter,
}: {
  decisionsByCoord: Map<string, ReviewerDecisionResponse[]>;
  entityTypes: ComparisonEntityType[];
  instancesByEntityType: Map<string, ComparisonInstance[]>;
  reviewerIds: string[];
  reviewerLabelById: Record<string, string>;
  reviewerAvatarById: Record<string, string | null | undefined>;
  resolution: ComparisonResolution;
  aiTrace?: ConsensusTraceContext;
  filter: 'attention' | 'all' | 'resolved';
  setFilter: (f: 'attention' | 'all' | 'resolved') => void;
}) {
  const rows: FlatRow[] = [];
  for (const et of entityTypes) {
    for (const inst of instancesByEntityType.get(et.id) ?? []) {
      for (const field of et.fields) {
        const entityLabel =
          (et.label ?? et.name ?? '') + (inst.label ? ` · ${inst.label}` : '');
        rows.push({
          coordKey: peerKey(inst.id, field.id),
          entityLabel,
          fieldLabel: field.label ?? field.name ?? field.id,
          instanceId: inst.id,
          field,
        });
      }
    }
  }

  const inAttention = (s: CoordStatus | undefined) =>
    s === 'conflict' || s === 'required_gap' || s === 'single_filler';
  const visible = rows.filter((r) => {
    const s = resolution.statusByCoord.get(r.coordKey);
    if (filter === 'attention') return inAttention(s);
    if (filter === 'resolved') return s === 'resolved';
    return true;
  });

  const columnCount = reviewerIds.length + 2; // field + reviewers + consensus
  const chips: Array<{ id: typeof filter; label: string; count: number | null }> = [
    { id: 'attention', label: t('consensus', 'filterAttention'), count: resolution.needsAttentionCount },
    { id: 'all', label: t('consensus', 'filterAll'), count: null },
    { id: 'resolved', label: t('consensus', 'filterResolved'), count: resolution.resolvedCount },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-3" data-testid="run-reviewer-comparison">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="consensus-filters">
          {chips.map((c) => (
            <Button
              key={c.id}
              type="button"
              size="sm"
              variant={filter === c.id ? 'secondary' : 'ghost'}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
              className="h-7 text-xs"
              data-testid={`consensus-filter-${c.id}`}
            >
              {c.label}
              {c.count !== null ? (
                <span className="ml-1 text-muted-foreground">· {c.count}</span>
              ) : null}
            </Button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground" data-testid="consensus-nothing">
            {t('consensus', 'nothingToReconcile')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  <th className="py-2 pr-4 font-medium text-muted-foreground">
                    {t('shared', 'fieldLabel')}
                  </th>
                  {reviewerIds.map((rid) => (
                    <th key={rid} className="px-3 py-2 font-medium">
                      <span className="flex items-center gap-1.5">
                        {reviewerAvatarById[rid] ? (
                          <img
                            src={reviewerAvatarById[rid] as string}
                            alt=""
                            className="h-4 w-4 rounded-full"
                          />
                        ) : null}
                        {reviewerLabelById[rid] ?? rid}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium min-w-[13rem]">
                    {t('consensus', 'consensusColumnLabel')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <ResolveRow
                    key={r.coordKey}
                    row={r}
                    peers={decisionsByCoord.get(r.coordKey) ?? []}
                    reviewerIds={reviewerIds}
                    reviewerLabelById={reviewerLabelById}
                    status={resolution.statusByCoord.get(r.coordKey)}
                    resolved={resolution.resolvedByCoord.get(r.coordKey)}
                    peersRevealed={resolution.peersRevealed}
                    disabled={resolution.disabled}
                    columnCount={columnCount}
                    onSelectExisting={resolution.onSelectExisting}
                    onManualOverride={resolution.onManualOverride}
                    aiTrace={aiTrace}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function ResolveRow({
  row,
  peers,
  reviewerIds,
  reviewerLabelById,
  status,
  resolved,
  peersRevealed,
  disabled,
  columnCount,
  onSelectExisting,
  onManualOverride,
  aiTrace,
}: {
  row: FlatRow;
  peers: ReviewerDecisionResponse[];
  reviewerIds: string[];
  reviewerLabelById: Record<string, string>;
  // Undefined ⇒ an untouched, non-required coord (in no bucket): shown only
  // under the "All" filter, non-actionable, no status badge.
  status: CoordStatus | undefined;
  resolved: ResolvedConsensusLike | undefined;
  peersRevealed: boolean;
  disabled: boolean;
  columnCount: number;
  onSelectExisting: ComparisonResolution['onSelectExisting'];
  onManualOverride: ComparisonResolution['onManualOverride'];
  aiTrace?: ConsensusTraceContext;
}) {
  const [editing, setEditing] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const isResolved = !!resolved;
  // Agreed rows (and untouched optional coords) are non-actionable — arbitrator
  // override on agreed rows is out of scope; every other state can be
  // adopted / overridden.
  const canAct = status !== 'agreed' && status !== undefined;
  const showActions = canAct && (!isResolved || editing);

  const close = () => {
    setEditing(false);
    setOverrideOpen(false);
  };

  const resolvedReviewerName =
    resolved?.mode === 'select_existing'
      ? (() => {
          const d = peers.find((x) => x.id === resolved.selected_decision_id);
          return d ? (reviewerLabelById[d.reviewer_id] ?? d.reviewer_id) : null;
        })()
      : null;

  // Seed for "Change" on a manual override: unwrap the stored envelope back to
  // the form shape. A coded marker seeds empty (the editor's marker toggle can
  // re-select it) so a re-save can't materialize the label as an in-band string.
  const overrideSeed =
    resolved?.mode === 'manual_override' && absentReasonLabel(resolved.value) === null
      ? unwrapValueEnvelope(resolved.value)
      : undefined;

  return (
    <>
      <tr
        className="border-b border-border/30 align-top"
        data-testid={`consensus-coord-${row.coordKey}`}
      >
        <FieldLabelCell
          entityLabel={row.entityLabel}
          fieldLabel={row.fieldLabel}
          traceSlot={fieldTraceSlot(aiTrace, row.instanceId, row.field, peers, reviewerLabelById)}
        />
        {reviewerIds.map((rid) => {
          const decision = peers.find((d) => d.reviewer_id === rid);
          const isReject = decision?.decision === 'reject';
          return (
            <td key={rid} className="px-3 py-2">
              {isReject ? (
                <span className="text-xs italic text-muted-foreground">
                  {t('shared', 'compareRejected')}
                </span>
              ) : decision ? (
                <span className="flex flex-col items-start gap-1">
                  <span className="flex items-center gap-1">
                    <span>{displayValue(decision.value)}</span>
                    {aiTrace ? (
                      <ReviewerAITrace
                        decision={decision}
                        field={row.field}
                        articleId={aiTrace.articleId}
                        getHistory={aiTrace.getHistory}
                        reviewerLabel={reviewerLabelById[rid] ?? rid}
                        adoptionByProposalId={buildPeerAdoptionMap(peers, reviewerLabelById, {
                          excludeReviewerId: rid,
                        })}
                        hasAISuggestion={
                          aiTrace.aiSuggestions
                            ? !!aiTrace.aiSuggestions[ownKey(row.instanceId, row.field.id)]
                            : null
                        }
                      />
                    ) : null}
                  </span>
                  {showActions ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      disabled={disabled}
                      aria-label={t('consensus', 'adoptValueAria')}
                      onClick={() =>
                        void onSelectExisting({
                          instanceId: row.instanceId,
                          fieldId: row.field.id,
                          decisionId: decision.id,
                        })
                      }
                      data-testid={`consensus-accept-${decision.id}`}
                    >
                      {t('consensus', 'panelUseThisValue')}
                    </Button>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('shared', 'compareNoValue')}</span>
              )}
            </td>
          );
        })}
        <td className="px-3 py-2 align-top">
          {isResolved && !editing ? (
            <div className="space-y-1" data-testid={`consensus-resolved-${row.coordKey}`}>
              <Badge
                variant="outline"
                className="border-success/30 bg-success/10 text-success"
              >
                <ShieldCheck className="mr-1 h-3 w-3" />
                {t('consensus', 'panelResolved')}
              </Badge>
              <div className="text-sm">{displayValue(resolved!.value)}</div>
              <div className="text-[11px] text-muted-foreground">
                {resolved!.mode === 'manual_override'
                  ? t('consensus', 'resolvedCustom')
                  : peersRevealed && resolvedReviewerName
                    ? t('consensus', 'resolvedFromReviewer').replace(
                        '{{reviewer}}',
                        resolvedReviewerName,
                      )
                    : t('consensus', 'resolvedCustom')}
              </div>
              {resolved!.rationale ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help text-[11px] underline decoration-dotted">
                      {t('consensus', 'resolvedRationaleLabel')}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">{resolved!.rationale}</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={disabled}
                  onClick={() => {
                    setEditing(true);
                    if (resolved!.mode === 'manual_override') setOverrideOpen(true);
                  }}
                  data-testid={`consensus-change-${row.coordKey}`}
                >
                  {t('consensus', 'change')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1.5">
              {status && status !== 'resolved' ? (
                <Badge variant="outline" className={STATUS_CLASS[status]}>
                  {statusBadgeLabel(status)}
                </Badge>
              ) : status === undefined ? (
                <span className="text-muted-foreground">—</span>
              ) : null}
              {showActions && !overrideOpen ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={disabled}
                  onClick={() => setOverrideOpen(true)}
                  data-testid={`consensus-override-toggle-${row.coordKey}`}
                >
                  {t('consensus', 'overrideAction')}
                </Button>
              ) : null}
              {editing && !overrideOpen ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={disabled}
                  onClick={close}
                  data-testid={`consensus-cancel-edit-${row.coordKey}`}
                >
                  {t('consensus', 'cancel')}
                </Button>
              ) : null}
            </div>
          )}
        </td>
      </tr>
      {overrideOpen ? (
        <tr>
          <td colSpan={columnCount} className="px-3 pb-3">
            <ConsensusOverrideEditor
              coordKey={row.coordKey}
              field={toEditorField(row.field)}
              disabled={disabled}
              initialValue={overrideSeed}
              initialRationale={resolved?.rationale ?? undefined}
              onCancel={close}
              onPublish={async (value, rationale) => {
                await onManualOverride({
                  instanceId: row.instanceId,
                  fieldId: row.field.id,
                  value,
                  rationale,
                });
                close();
              }}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}
