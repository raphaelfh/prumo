/**
 * Assessment item input
 *
 * Renders the appropriate input for an assessment item:
 * - Radio buttons for allowed levels (Low Risk, High Risk, etc.)
 * - Textarea for comments/justification (optional)
 * - Shows item guidance
 * - Shows AI suggestions when available
 *
 * Based on FieldInput.tsx, simplified for assessment items (DRY + KISS).
 *
 * @component
 */

import {memo, useState} from 'react';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {AlertCircle, Info, Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import type {
  AIAssessmentSuggestion,
  AIAssessmentSuggestionHistoryItem,
  AssessmentItem,
  AssessmentResponse
} from '@/types/assessment';
import {AISuggestionDisplay} from './ai/AISuggestionDisplay';

// =================== INTERFACES ===================

interface AssessmentItemInputProps {
  item: AssessmentItem;
  value: AssessmentResponse | null;
  onChange: (value: AssessmentResponse) => void;
  aiSuggestion?: AIAssessmentSuggestion;
  /** Aceitar sugestão: pai deve passar callback que recebe itemId (mesmo padrão que Extraction/InstanceCard). */
  onAcceptAI?: (itemId: string) => Promise<void>;
  /** Rejeitar sugestão: pai deve passar callback que recebe itemId. */
  onRejectAI?: (itemId: string) => Promise<void>;
  onTriggerAI?: (itemId: string) => Promise<void>;
  /** Loading por item: função (itemId) => boolean ou boolean (resolvido pelo pai). */
  isActionLoading?: boolean | ((itemId: string) => boolean);
  isTriggerLoading?: boolean;
  getSuggestionsHistory?: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>;
  disabled?: boolean;
}

// =================== COMPONENT ===================

export function AssessmentItemInput(props: AssessmentItemInputProps) {
  const {
    item,
    value,
    onChange,
    aiSuggestion,
    onAcceptAI,
    onRejectAI,
    onTriggerAI,
    isActionLoading,
    isTriggerLoading,
    getSuggestionsHistory: _getSuggestionsHistory,
    disabled,
  } = props;

  const [showGuidance, setShowGuidance] = useState(false);

    // Local state for editing
  const selectedLevel = value?.selected_level ?? '';
  const notes = value?.notes ?? '';

    // Determine suggestion state (mirrors Extraction: FieldInput)
  const hasPendingSuggestion = aiSuggestion?.status === 'pending';
  const hasAcceptedSuggestion = aiSuggestion?.status === 'accepted';
  const hasInvalidLevel = hasPendingSuggestion
    && aiSuggestion?.suggested_value?.level
    && !item.allowed_levels.includes(aiSuggestion.suggested_value.level);

    // Manual edit: value in field differs from AI-accepted (hide suggestion when user edited)
  const aiAcceptedLevel = hasAcceptedSuggestion ? aiSuggestion?.suggested_value?.level : null;
  const hasManualValue = !!selectedLevel && (!hasAcceptedSuggestion || selectedLevel !== aiAcceptedLevel);

    // Show suggestion for pending, accepted (if not manually edited) and rejected (allow revert)
  const shouldShowSuggestion = aiSuggestion && (
    aiSuggestion.status === 'pending' ||
    (aiSuggestion.status === 'accepted' && !hasManualValue) ||
    aiSuggestion.status === 'rejected'
  );

    // Handler for level change
  const buildResponse = (
    overrides: Partial<AssessmentResponse>
  ): AssessmentResponse => ({
    item_id: item.id,
    selected_level: value?.selected_level ?? '',
    notes: value?.notes ?? null,
    confidence: value?.confidence ?? null,
    evidence: value?.evidence ?? [],
    ...overrides,
  });

  const handleLevelChange = (level: string) => {
    onChange(
      buildResponse({
        selected_level: level,
        notes,
      })
    );
  };

    // Handler for notes change
  const handleNotesChange = (newNotes: string) => {
    onChange(
      buildResponse({
        selected_level: selectedLevel,
        notes: newNotes,
      })
    );
  };

    // Validation
  const hasError = item.is_required && !selectedLevel;

  return (
      <div className="grid grid-cols-[30%_1fr] gap-4 py-4 items-start border-b border-border/40 last:border-b-0">
          {/* Left column: Label + Code + Guidance */}
      <div className="space-y-2 pt-2">
        <div className="flex items-start justify-between gap-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{item.item_code}</span>
            {item.is_required && <span className="text-destructive">*</span>}
          </Label>
          {item.guidance && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 p-0"
                  onClick={() => setShowGuidance(!showGuidance)}
                >
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                  <p>{t('assessment', 'itemInputViewGuidance')}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <p className="text-sm text-foreground leading-relaxed">{item.question}</p>

        {/* Guidance expandível */}
        {showGuidance && item.guidance && (
            <div className="mt-2 p-3 bg-muted/50 rounded-md border border-border/50">
                <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {item.guidance}
            </p>
          </div>
        )}
      </div>

          {/* Right column: Input */}
      <div className="space-y-3">
          {/* AI Trigger Button - show when no suggestion or rejected */}
        {onTriggerAI && (!aiSuggestion || aiSuggestion.status === 'rejected') && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onTriggerAI(item.id)}
              disabled={isTriggerLoading || disabled}
              className="gap-2"
            >
              {isTriggerLoading ? (
                <>
                  <Sparkles className="h-4 w-4 animate-pulse" />
                    {t('assessment', 'itemInputEvaluatingAI')}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                    {t('assessment', 'itemInputAssessWithAI')}
                </>
              )}
            </Button>
          </div>
        )}

          {/* Radio buttons for levels */}
        <div>
          <RadioGroup
            value={selectedLevel}
            onValueChange={handleLevelChange}
            disabled={disabled}
            className={cn(
                "space-y-1.5",
              hasError && "border-l-2 border-destructive pl-3"
            )}
          >
            {item.allowed_levels.map((level) => (
              <div key={level} className="flex items-center space-x-2">
                <RadioGroupItem value={level} id={`${item.id}-${level}`} />
                <Label
                  htmlFor={`${item.id}-${level}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {level}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

          {/* Inline AI suggestion (mirrors Extraction: value + % + accept/reject) */}
        {shouldShowSuggestion && aiSuggestion && (
          <AISuggestionDisplay
            suggestion={aiSuggestion}
            itemId={item.id}
            onAccept={onAcceptAI && !hasInvalidLevel ? () => onAcceptAI(item.id) : undefined}
            onReject={onRejectAI ? () => onRejectAI(item.id) : undefined}
            loading={typeof isActionLoading === 'function' ? isActionLoading(item.id) : Boolean(isActionLoading)}
          />
        )}

          {/* Textarea for notes */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
              {t('assessment', 'itemInputCommentLabel')}
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder={t('assessment', 'itemInputCommentPlaceholder')}
            disabled={disabled}
            className="text-[13px] min-h-[80px] resize-none"
          />
        </div>

        {/* Validation error */}
        {hasError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
              {t('assessment', 'itemInputRequiredError')}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Exports memoized version to avoid unnecessary re-renders
 */
export default memo(AssessmentItemInput, (prevProps, nextProps) => {
  const aiSuggestionChanged =
    prevProps.aiSuggestion?.id !== nextProps.aiSuggestion?.id ||
    prevProps.aiSuggestion?.status !== nextProps.aiSuggestion?.status;

  return (
    prevProps.item.id === nextProps.item.id &&
    JSON.stringify(prevProps.value) === JSON.stringify(nextProps.value) &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.isActionLoading === nextProps.isActionLoading &&
    prevProps.isTriggerLoading === nextProps.isTriggerLoading &&
    !aiSuggestionChanged
  );
});
