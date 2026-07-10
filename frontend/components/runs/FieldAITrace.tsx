/**
 * Per-field AI trace for the consensus surfaces (spec 2026-07-09 D1).
 *
 * A discrete, endorsement-neutral AI-suggestion icon on the field-label row.
 * Its existence says "the AI proposed something for this field" — never "this
 * value is AI-derived". Column-independent; renders on ALL row states and for
 * ALL roles at consensus (resolve + read-only), which is the whole point: a
 * non-arbitrator / viewer now sees where a field's value came from.
 *
 * Opens the shared review popover read-only (audit-only — no "Use this
 * version"), pinning nothing (`pinNewestWhenNoSelection={false}`, D8) so a
 * value nobody chose is never mislabeled "Selected". Honest peer cross-marks
 * ride `adoptionByProposalId` (link-keyed; wording refined per loaded version).
 *
 * NEVER fabricate provenance: the icon's presence is keyed only on the AI
 * proposal existing for the coord (decided by the caller); cross-marks exist
 * only on the append-only link. Value coincidence must never mint either.
 *
 * Service-free / jsdom-safe: `getHistory` is a prop; the popover owns the lazy
 * apiClient chain (GenerationDetailsDialog). Ran-by identity is inherited from
 * `RunEditabilityContext.showPeerIdentity` inside the popover (D7).
 */
import {Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import type {AISuggestionHistoryItem} from '@/types/ai-extraction';
import type {PeerAdoptionMark} from '@/lib/runs/adoption';
import {AISuggestionReviewPopover} from '@/components/extraction/ai/AISuggestionReviewPopover';
import type {ComparisonField} from './RunReviewerComparison';

export interface FieldAITraceProps {
  instanceId: string;
  fieldId: string;
  field: Pick<ComparisonField, 'id' | 'field_type' | 'allowed_values'>;
  articleId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  /** proposal id → the reviewers linked to it (self included at field level,
   *  D6); the Adopted/Edited wording is resolved per version in the popover. */
  adoptionByProposalId: Record<string, PeerAdoptionMark[]>;
  /**
   * The coord has an AI proposal (`aiSuggestions[coordKey]` present). `false` ⇒
   * no proposal; `null` ⇒ the signal is unavailable (suggestions loading/failed)
   * — render nothing rather than a misleading absence. Only `true` shows the icon.
   */
  hasAISuggestion: boolean | null;
}

export function FieldAITrace({
  instanceId,
  fieldId,
  field,
  articleId,
  getHistory,
  adoptionByProposalId,
  hasAISuggestion,
}: FieldAITraceProps) {
  if (hasAISuggestion !== true) return null;

  const label = t('consensus', 'fieldTraceAria');
  return (
    // Tooltip OUTSIDE the popover trigger (FieldInput / ReviewerAITrace
    // pattern): nesting a Tooltip inside PopoverTrigger asChild drops the
    // trigger props.
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <AISuggestionReviewPopover
            instanceId={instanceId}
            fieldId={fieldId}
            getHistory={getHistory}
            articleId={articleId}
            fieldType={field.field_type}
            allowedValues={field.allowed_values}
            title={label}
            adoptionByProposalId={adoptionByProposalId}
            pinNewestWhenNoSelection={false}
            trigger={
              <Button
                size="icon"
                variant="ghost"
                // Muted at rest so the presence pattern down the column stays
                // scannable without shouting; AI accent on hover/focus (D9).
                className="h-4 w-4 shrink-0 text-muted-foreground/50 hover:bg-ai/10 hover:text-ai focus-visible:text-ai"
                aria-label={label}
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
              </Button>
            }
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
