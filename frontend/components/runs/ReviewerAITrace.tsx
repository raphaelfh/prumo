/**
 * Per-reviewer-cell AI trace for the consensus resolve table (spec 2026-07-04
 * D1/D4).
 *
 * - Linked, non-reject decision → sparkles icon-button opening the shared
 *   review popover read-only, pinned to the adopted version, with adoption
 *   attribution (title, Adopted/Edited chip, cross-marks).
 * - Unlinked + the coord verifiably has NO AI suggestion → "Manual" chip.
 * - Unlinked but AI existed (pre-D0 history) or the AI-existence signal is
 *   unavailable → nothing: "can't tell" must not render as "Manual" on an
 *   adjudication surface.
 *
 * Service-free: `getHistory` arrives as a prop; the popover lazy-loads its
 * apiClient chain (GenerationDetailsDialog), keeping this module jsdom-safe.
 */
import {Sparkles} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import type {AISuggestionHistoryItem} from '@/types/ai-extraction';
import type {ReviewerDecisionResponse} from '@/hooks/runs/types';
import {AISuggestionReviewPopover} from '@/components/extraction/ai/AISuggestionReviewPopover';
import type {ComparisonField} from './RunReviewerComparison';

export interface ReviewerAITraceProps {
  decision: ReviewerDecisionResponse;
  field: Pick<ComparisonField, 'id' | 'field_type' | 'allowed_values'>;
  articleId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  reviewerLabel: string;
  /** proposal id → OTHER reviewers' label(s) adopting it (D3 cross-marking). */
  adoptionByProposalId: Record<string, string>;
  /**
   * The screen's aiSuggestions map has an entry for this coord. `null` means
   * the signal is unavailable (suggestions loading/failed) — render nothing
   * for unlinked decisions rather than a false "Manual".
   */
  hasAISuggestion: boolean | null;
}

export function ReviewerAITrace(props: ReviewerAITraceProps) {
  const {decision, field, articleId, getHistory, reviewerLabel, adoptionByProposalId, hasAISuggestion} = props;

  // D1 excludes reject decisions entirely (the cell already reads "Rejected").
  if (decision.decision === 'reject') return null;

  if (decision.proposal_record_id == null) {
    // D4: only a verified "no AI suggestion exists" earns the Manual chip.
    if (hasAISuggestion !== false) return null;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="h-5 shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            {t('consensus', 'traceManualChip')}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('consensus', 'traceManualChipTooltip')}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  const title = t('consensus', 'traceTitle').replace('{{name}}', reviewerLabel);
  return (
    // Tooltip OUTSIDE the popover trigger (FieldInput pattern): nesting
    // Tooltip inside PopoverTrigger asChild drops the trigger props.
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex">
          <AISuggestionReviewPopover
            instanceId={decision.instance_id}
            fieldId={decision.field_id}
            getHistory={getHistory}
            selectedProposalId={decision.proposal_record_id}
            articleId={articleId}
            fieldType={field.field_type}
            allowedValues={field.allowed_values}
            title={title}
            adoption={{
              reviewerLabel,
              decisionValue: decision.value,
              decisionKind: decision.decision,
            }}
            adoptionByProposalId={adoptionByProposalId}
            trigger={
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 text-ai hover:bg-ai/10 hover:text-ai"
                aria-label={title}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            }
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{title}</p>
      </TooltipContent>
    </Tooltip>
  );
}
