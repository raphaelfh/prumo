/**
 * AI suggestion display component - Extraction
 *
 * Shows the suggested value + confidence + quick accept/reject below the input.
 * The rich review surface (version history, provenance, cited evidence + locate)
 * lives behind `AISuggestionReviewPopover`. When a `review` binding is supplied,
 * the value/confidence (and the "no information" indicator) become a trigger
 * that opens that SAME popover — so the user can reach version history straight
 * from the inline strip, not only from the History icon in `FieldInput`.
 *
 * @component
 */

import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import {AISuggestionActions} from '@/components/shared/ai-suggestions';
import {AISuggestionConfidence} from './shared/AISuggestionConfidence';
import {AISuggestionValue} from './shared/AISuggestionValue';
import {AISuggestionReviewPopover} from './AISuggestionReviewPopover';
import {isAbstention, isSuggestionAccepted} from '@/lib/ai-extraction/suggestionUtils';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

/**
 * Wiring for the review popover the inline strip opens. Mirrors the props the
 * History-icon popover in `FieldInput` already binds, so both entry points
 * resolve to one surface for the same (instance, field) coord.
 */
export interface AISuggestionReviewBinding {
  instanceId: string;
  fieldId: string;
  getHistory: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  selectedProposalId?: string;
  onSelect: (proposalRecordId: string, value: unknown, confidence: number) => void;
  onClear?: () => void;
  /** Defaults to 'end' so the popover opens left, clear of the PDF panel. */
  align?: 'start' | 'center' | 'end';
  /** Field type + allowed_values so the version-history popover resolves a
   *  select/multiselect CODE to its human label, same as the inline card. */
  fieldType?: string | null;
  allowedValues?: unknown;
}

interface AISuggestionDisplayProps {
  suggestion: AISuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
  /** When present, the value area becomes a trigger for the review popover. */
  review?: AISuggestionReviewBinding;
  /** Field type + allowed_values so a select/multiselect CODE renders as its
   *  human label on the inline card. Omit for non-select fields. */
  fieldType?: string | null;
  allowedValues?: unknown;
}

/**
 * Wraps `children` in the review popover's trigger button when a binding is
 * supplied; otherwise renders a plain container with the same layout classes.
 */
function ReviewTrigger({
  review,
  className,
  children,
}: {
  review?: AISuggestionReviewBinding;
  className?: string;
  children: React.ReactNode;
}) {
  if (!review) {
    return <div className={className}>{children}</div>;
  }
  return (
    // The binding is exactly the popover's props minus `trigger`, so spread it;
    // default align to 'end' so the popover opens left, clear of the PDF panel.
    <AISuggestionReviewPopover
      {...review}
      align={review.align ?? 'end'}
      trigger={
        <button
          type="button"
          aria-label={t('extraction', 'reviewOpenFromValue')}
          title={t('extraction', 'reviewOpenFromValue')}
          className={cn(
            'rounded-md text-left transition-colors cursor-pointer hover:bg-ai/5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai/40 focus-visible:ring-offset-1',
            className,
          )}
        >
          {children}
        </button>
      }
    />
  );
}

export function AISuggestionDisplay({
  suggestion,
  onAccept,
  onReject,
  loading = false,
  review,
  fieldType,
  allowedValues,
}: AISuggestionDisplayProps) {
  const isAccepted = isSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';

  // A "no information found" outcome is a first-class ACCEPTABLE proposal
  // (ADR-0016 decision #3): the strip stays quiet and de-emphasized — never a
  // loud "(empty) · 0%" — but exposes the same one-click accept/reject as a
  // real suggestion, so accepting writes the marker into the form and
  // activates the field's "No information" disposition. It still opens the
  // review popover (history + provenance) when a binding is supplied.
  if (isAbstention(suggestion.value)) {
    return (
      <div className="mt-2 animate-in fade-in duration-200 w-full">
        <div className="flex items-center gap-2 w-full">
          <ReviewTrigger
            review={review}
            className="flex-1 min-w-0 inline-flex px-1.5 py-0.5 -mx-1.5"
          >
            <span className="text-xs italic text-muted-foreground">
              {t('extraction', 'reviewNoInformation')}
            </span>
          </ReviewTrigger>
          <div className="flex items-center gap-2 shrink-0 pr-1">
            <AISuggestionActions
              onAccept={onAccept}
              onReject={onReject}
              loading={loading}
              isAccepted={isAccepted}
              isRejected={isRejected}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-200 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-2 w-full">
          {/* Suggested value + confidence — opens the review popover on click */}
        <ReviewTrigger
          review={review}
          className="flex-1 min-w-0 w-full sm:w-auto flex items-center gap-2 px-1.5 py-1 -mx-1.5"
        >
          <AISuggestionValue
            suggestion={suggestion}
            maxLength={150}
            className="flex-1 min-w-0"
            fieldType={fieldType}
            allowedValues={allowedValues}
          />
          <AISuggestionConfidence suggestion={suggestion} />
        </ReviewTrigger>

          {/* Action buttons - always show */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end sm:justify-start pr-1">
          <div className="overflow-visible">
            <AISuggestionActions
              onAccept={onAccept}
              onReject={onReject}
              loading={loading}
              isAccepted={isAccepted}
              isRejected={isRejected}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
