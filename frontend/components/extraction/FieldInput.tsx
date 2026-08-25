/**
 * Universal extraction field input
 *
 * Renders the appropriate input by field type:
 * - text: Input or Textarea
 * - number: Number input + unit badge
 * - date: DatePicker
 * - select: Select dropdown
 * - multiselect: Multi-select
 * - boolean: Switch
 *
 * Also shows AI badges and other extractions (future).
 *
 * @component
 */

import {memo, useState} from 'react';
import {Label} from '@/components/ui/label';
import {AlertCircle, Check, History} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import type {ExtractionField} from '@/types/extraction';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import {AISuggestionDisplay, type AISuggestionReviewBinding} from './ai/AISuggestionDisplay';
import {AISuggestionReviewPopover} from './ai/AISuggestionReviewPopover';
import {FieldValueEditor} from './FieldValueEditor';
import {isEmptyValue, isValidNumber} from '@/lib/ai-extraction/valueParser';
import {isSuggestionPending} from '@/lib/ai-extraction/suggestionUtils';
import {valueAbsentReason} from '@/lib/extraction/valueSemantics';
import {useJustUpdatedValue} from '@/hooks/extraction/useJustUpdatedValue';
import {useRunEditability} from '@/components/runs/RunEditabilityContext';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface FieldInputProps {
  field: ExtractionField;
  instanceId: string;
  value: any;
  onChange: (value: any) => void;
  projectId: string;
  aiSuggestion?: AISuggestion;
  onAcceptAI?: () => void;
  onRejectAI?: () => void;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  /**
   * Select a specific AI version by proposal id (drilled verbatim from the
   * hook; FieldInput binds the coord). Powers the review popover's version
   * switching; a null value records an explicit "no information" selection.
   */
  selectSuggestion?: (
    instanceId: string,
    fieldId: string,
    proposalRecordId: string,
    value: unknown,
    confidence: number,
  ) => void | Promise<void>;
  disabled?: boolean;
  /** Threaded to the review popover's generation dialog so it can lazily fetch
   *  the stored markdown the LLM received. */
  articleId?: string;
}

// =================== COMPONENT ===================

export function FieldInput(props: FieldInputProps) {
  const { field, instanceId, value, onChange, disabled, aiSuggestion, onAcceptAI, onRejectAI, getSuggestionsHistory, selectSuggestion, articleId } = props;
  // Read-only run (published/consensus/pending): every input variant and the
  // disposition buttons disable; the actionable AI chrome (badge + inline
  // accept/reject strip) hides — the History popover stays as audit trail.
  const { readOnly } = useRunEditability();
  const inputDisabled = disabled || readOnly;
  const [validationError, setValidationError] = useState<string | null>(null);
  // Briefly highlights this field when its value was just updated (e.g. by an
  // AI extraction refresh) so the user sees what changed without having to
  // hunt the page for newly-populated cells.
  const justUpdated = useJustUpdatedValue(`${instanceId}_${field.id}`);

    // Fixed comfortable spacing
  const containerPadding = 'py-2.5';
  const gap = 'gap-x-3.5 gap-y-1';

    // Display value logic:
    // - Local state value always has priority (manual or AI-accepted)
    // - If there is accepted suggestion and no manual value, show suggestion value
  const hasAIPending = aiSuggestion ? isSuggestionPending(aiSuggestion) : false;
  const hasAIAccepted = aiSuggestion ? aiSuggestion.status === 'accepted' : false;

    // Helper to normalize values for comparison
  const normalizeValueForComparison = (val: any): any => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'value' in val) {
      return { value: val.value, unit: val.unit || null };
    }
    return val;
  };

    // Distinguish manual value from AI-accepted:
    // - If accepted suggestion and current value equals suggestion value, NOT manual
    // - If current value differs from accepted suggestion, manual (user edited)
    // - If no accepted suggestion, any non-empty value is considered manual
  const aiAcceptedValue = hasAIAccepted && aiSuggestion?.value !== null && aiSuggestion?.value !== undefined 
    ? aiSuggestion.value 
    : null;

    // More robust value comparison (handles objects and arrays)
  const isValueEqualToAccepted = aiAcceptedValue !== null && 
    JSON.stringify(normalizeValueForComparison(value)) === JSON.stringify(normalizeValueForComparison(aiAcceptedValue));

    // If field has value but it's not equal to accepted, it's manual
    // If no accepted suggestion, field value is considered manual
  const hasManualValue = !isEmptyValue(value) && (!hasAIAccepted || !isValueEqualToAccepted);

    // A resolved disposition marker ({value:null, absent_reason}) means "no scalar
    // value on purpose" (ADR-0016). The typed input renders empty — the marker is
    // shown by the disposition control below; typing a real value clears it.
  const activeReason = valueAbsentReason(value);

    // A required field the reviewer has not answered yet. `isEmptyValue` is the
    // shared oracle `computeRequiredFieldProgress` counts with, so this accent and
    // the rail's "N required left" can never disagree — and a resolved ADR-0016
    // marker reads as answered, so recording "No information" quiets the field.
    // Suppressed on read-only runs: a fill-completion CTA is noise on a published
    // view (same rule the nav rail footer already applies).
  const pendingRequired = field.is_required && isEmptyValue(value) && !readOnly;

    // Value to display: the form value, and ONLY the form value. Falling back
    // to an accepted suggestion when the form value is empty made a cleared
    // field keep showing its old answer — no feedback that the clear landed,
    // and (because Radix suppresses onValueChange when the picked option already
    // equals the controlled value) no way to re-pick that same option. The AI's
    // value has its own surfaces: AISuggestionDisplay and the review popover.
  const displayValue = activeReason || isEmptyValue(value) ? '' : value;

    // Basic validation
  const validateValue = (val: any): boolean => {
      // For required fields, check value is not empty
    if (field.is_required) {
      if (isEmptyValue(val)) {
          setValidationError(t('extraction', 'fieldRequired'));
        return false;
      }
    }

    if (field.field_type === 'number') {
        // If has value but not a valid number
      if (!isEmptyValue(val) && !isValidNumber(val)) {
          setValidationError(t('extraction', 'fieldMustBeNumber'));
        return false;
      }
    }

    setValidationError(null);
    return true;
  };

  const handleChange = (newValue: any) => {
    validateValue(newValue);
    onChange(newValue);
  };

    // ADR-0016 runtime disposition control — record a coded "no value, on purpose"
    // answer on ANY field type. `no_information` is universal; the opt-in codes
    // render only where the field enables them. Toggling the active one clears back
    // to unresolved. Setting a marker clears any validation error (it is resolved).
  const dispositions: { code: string; label: string; hint: string }[] = [
    {
      code: 'no_information',
      label: t('extraction', 'dispositionNoInformation'),
      hint: t('extraction', 'dispositionNoInformationHint'),
    },
    ...(field.allows_not_applicable
      ? [
          {
            code: 'not_applicable',
            label: t('extraction', 'dispositionNotApplicable'),
            hint: t('extraction', 'dispositionNotApplicableHint'),
          },
        ]
      : []),
    ...(field.allows_not_evaluated
      ? [
          {
            code: 'not_evaluated',
            label: t('extraction', 'dispositionNotEvaluated'),
            hint: t('extraction', 'dispositionNotEvaluatedHint'),
          },
        ]
      : []),
  ];
  const setDisposition = (code: string) => {
    if (activeReason === code) {
      onChange('');
    } else {
      setValidationError(null);
      onChange({ value: null, absent_reason: code });
    }
  };

    // Render input by type — delegated to the shared, AI-chrome-free editor
    // (FieldValueEditor) so the consensus override can reuse the exact same
    // per-type inputs. This component keeps the AI badges, disposition row,
    // validation, and read-only gating around it.
  const renderInput = () => (
    <FieldValueEditor
      field={field}
      value={displayValue}
      onChange={handleChange}
      disabled={inputDisabled}
      inputClassName={cn(
        // The empty box itself carries the accent, so the eye lands on the thing
        // to type into — not just on the row gutter. A real validation error
        // outranks it (listed last so tailwind-merge keeps the destructive border).
        pendingRequired && 'border-warning/70 bg-warning/5',
        validationError && 'border-destructive',
      )}
      textAccentClassName={cn(hasAIPending && 'border-ai/60 bg-ai/5')}
    />
  );

    // Determine whether to show suggestion display below input
    // Show if:
    // - Suggestion exists (pending, accepted or rejected) AND
    // - For PENDING: always show (even if field has value)
    // - For ACCEPTED: show if current value equals accepted (not manually edited)
    // - For REJECTED: show to allow revert
  const shouldShowSuggestion = aiSuggestion && (
      // Always show pending suggestions
    aiSuggestion.status === 'pending' ||
    // Show accepted if value is still equal (not manually edited)
    (aiSuggestion.status === 'accepted' && !hasManualValue) ||
    // Show rejected to allow revert
    aiSuggestion.status === 'rejected'
  );

  // One binding for the AI review popover (its props minus `trigger`), shared by
  // the History-icon trigger and the inline suggestion strip so the two entry
  // points to the same coord can't drift. align='end' opens it left of the
  // right-edge trigger, clear of the PDF/markdown viewer.
  const reviewBinding: AISuggestionReviewBinding | undefined =
    getSuggestionsHistory && aiSuggestion
      ? {
          instanceId,
          fieldId: field.id,
          getHistory: getSuggestionsHistory,
          selectedProposalId: aiSuggestion.id,
          onSelect: (proposalRecordId, selectedValue, selectedConfidence) =>
            selectSuggestion?.(instanceId, field.id, proposalRecordId, selectedValue, selectedConfidence),
          onClear: onRejectAI,
          align: 'end',
          // So the version-history popover resolves a select/multiselect CODE
          // to its human label, same as the inline card.
          fieldType: field.field_type,
          allowedValues: field.allowed_values,
          articleId,
        }
      : undefined;

  return (
      <div
          data-just-updated={justUpdated || undefined}
          data-field-row
          data-pending-required={pendingRequired || undefined}
          className={cn(
            // Stack label over input on narrow containers; switch to a capped-left
            // two-column grid at @md so the PDF panel width (not the viewport)
            // drives the breakpoint.
            'grid grid-cols-1 @md:grid-cols-[minmax(0,232px)_1fr] items-start',
            'border-b border-border/40 last:border-b-0 transition-colors',
            // Left gutter reserved on EVERY row (transparent when answered), so
            // marking a row pending tints the rail instead of shifting the whole
            // form sideways as fields get filled in.
            'border-l-2 border-l-transparent pl-2',
            pendingRequired && 'border-l-warning bg-warning/5',
            justUpdated && "field-just-updated",
            gap,
            containerPadding
          )}>

      {/* Left column: Label + Description */}
      <div className="space-y-1">
        <Label className="text-sm font-medium flex items-center gap-2">
          {field.label}
          {field.is_required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {field.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {field.description}
          </p>
        )}
      </div>
      
      {/* Coluna direita: Input */}
              <div className="space-y-2 min-w-0">
                  {/* Input with badge + history on the right */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            {renderInput()}
          </div>
          
          <div className="flex items-center gap-1 shrink-0">
              {/* Single AI trigger: review + select past versions, see how each
                  was generated, locate evidence, or clear. Replaces the old
                  split history + details popovers. */}
            {reviewBinding && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <AISuggestionReviewPopover
                      {...reviewBinding}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn(
                            "h-7 w-7",
                            "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                          title={t('extraction', 'reviewTitle')}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                      }
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{t('extraction', 'reviewTitle')}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

                  {/* Disposition control (ADR-0016): a quiet row to mark the field
                      "No information" (any type) or the opt-in Not applicable /
                      Not evaluated. Each button describes itself on hover; the
                      active one gets the accepted-style success ring (matching
                      the accept-suggestion affordance) + an explicit "recorded"
                      hint, so a blank input is never ambiguous. Clicking the
                      active one clears back to unresolved. */}
        {/* Local provider: the disposition row renders on EVERY field, so its
            tooltips must not depend on a caller-supplied provider. */}
        <TooltipProvider delayDuration={300}>
        <div className="flex flex-wrap items-center gap-1.5" data-disposition-control>
          {dispositions.map((d) => {
            const active = activeReason === d.code;
            return (
              <Tooltip key={d.code}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-pressed={active}
                    disabled={inputDisabled}
                    onClick={() => setDisposition(d.code)}
                    className={cn(
                      'h-6 gap-1 px-2 text-xs',
                      active
                        ? 'text-success ring-1 ring-inset ring-success bg-success/10 hover:bg-success/15 hover:text-success'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {active ? <Check className="h-3 w-3" /> : null}
                    {d.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{active ? t('extraction', 'dispositionActiveHint') : d.hint}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
          {activeReason ? (
            <span className="text-[11px] text-muted-foreground">
              {t('extraction', 'dispositionActiveHint')}
            </span>
          ) : null}
        </div>
        </TooltipProvider>

                  {/* Suggested value + accept/reject buttons below input — only
                      when no manual value, and never on read-only runs (a
                      published view offers no pending decisions to act on). */}
        {!readOnly && shouldShowSuggestion && (
          <AISuggestionDisplay
            suggestion={aiSuggestion}
            onAccept={onAcceptAI}
            onReject={onRejectAI}
            // Same review surface as the History icon (shared binding): clicking
            // the inline value/confidence opens the version history + provenance.
            review={reviewBinding}
            // Render a select/multiselect CODE as its human label on the card.
            fieldType={field.field_type}
            allowedValues={field.allowed_values}
          />
        )}

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {validationError}
          </p>
        )}
      </div>
    </div>
  );
}

// kept: custom comparator — compiler does not replicate arePropsEqual
export default memo(FieldInput, (prevProps, nextProps) => {
    // Optimized comparison: only props that affect THIS field
  const aiSuggestionChanged = prevProps.aiSuggestion?.id !== nextProps.aiSuggestion?.id ||
                                prevProps.aiSuggestion?.status !== nextProps.aiSuggestion?.status;

  return (
    prevProps.field.id === nextProps.field.id &&
    prevProps.instanceId === nextProps.instanceId &&
    prevProps.value === nextProps.value &&
    prevProps.disabled === nextProps.disabled &&
    !aiSuggestionChanged // Re-render when suggestion changes (status or ID)
  );
});

