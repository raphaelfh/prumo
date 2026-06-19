/**
 * Shared side-by-side reviewer comparison, driven entirely by `runDetail`.
 *
 * Used by BOTH the extraction and QA screens. Rows are `(instance, field)`
 * coordinates grouped by entity_type (section / QA domain) → instance; columns
 * are "You" plus one per reviewer who has a decision on the run. The peer data
 * comes from `reviewerSummary.decisionsByCoord` (already server-blinded via the
 * typed `/runs/{id}/view`), so when the caller is blind there are simply no peer
 * columns — no separate fetch, no direct Supabase read.
 *
 * Coordinate-key contract: peer decisions are keyed `${instanceId}::${fieldId}`
 * (double colon, from `useReviewerSummary`); the caller's own values are keyed
 * `${instanceId}_${fieldId}` (single underscore, the form's map). This component
 * is the single place that bridges the two.
 */

import type { ReviewerDecisionResponse } from '@/hooks/runs/types';
import { unwrap } from '@/hooks/runs/useReviewerSummary';
import { t } from '@/lib/copy';

export interface ComparisonField {
  id: string;
  label?: string | null;
  name?: string | null;
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

export interface RunReviewerComparisonProps {
  /** `${instanceId}::${fieldId}` → latest decision per distinct reviewer. */
  decisionsByCoord: Map<string, ReviewerDecisionResponse[]>;
  entityTypes: ComparisonEntityType[];
  instances: ComparisonInstance[];
  /** Caller's own values, keyed `${instanceId}_${fieldId}`. */
  ownValues: Record<string, unknown>;
  reviewerLabelById: Record<string, string>;
  reviewerAvatarById: Record<string, string | null | undefined>;
}

const peerKey = (instanceId: string, fieldId: string) => `${instanceId}::${fieldId}`;
const ownKey = (instanceId: string, fieldId: string) => `${instanceId}_${fieldId}`;

function displayValue(raw: unknown): string {
  const v = unwrap(raw);
  if (v === null || v === undefined || v === '') return t('shared', 'compareNoValue');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function RunReviewerComparison({
  decisionsByCoord,
  entityTypes,
  instances,
  ownValues,
  reviewerLabelById,
  reviewerAvatarById,
}: RunReviewerComparisonProps) {
  // Columns = distinct reviewers who have any decision on the run (sorted for
  // stable order). Empty ⇒ caller is blind / nobody else decided.
  const reviewerIds = [
    ...new Set(
      [...decisionsByCoord.values()].flat().map((d) => d.reviewer_id),
    ),
  ].sort();

  if (reviewerIds.length === 0) {
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

  return (
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
                return (
                  <tr
                    key={`${inst.id}_${field.id}`}
                    className="border-b border-border/30 align-top"
                  >
                    <th
                      scope="row"
                      className="py-2 pr-4 text-left font-normal text-muted-foreground"
                    >
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        {et.label ?? et.name ?? ''}
                        {inst.label ? ` · ${inst.label}` : ''}
                      </span>
                      {fieldLabel}
                    </th>
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
  );
}
