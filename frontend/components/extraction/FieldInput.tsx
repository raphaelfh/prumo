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
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Badge} from '@/components/ui/badge';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {SelectWithOther} from '@/components/ui/SelectWithOther';
import {MultiSelectWithOther} from '@/components/ui/MultiSelectWithOther';
import {Switch} from '@/components/ui/switch';
import {AlertCircle, History} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import type {ExtractionField} from '@/types/extraction';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import {OtherExtractionsPopover} from './colaboracao/OtherExtractionsPopover';
import {OtherExtractionsButton} from './colaboracao/OtherExtractionsButton';
import {AISuggestionDisplay} from './ai/AISuggestionDisplay';
import {AISuggestionBadge} from './ai/AISuggestionBadge';
import {AISuggestionHistoryPopover} from './ai/AISuggestionHistoryPopover';
import {getRelatedUnits} from '@/lib/unitConversions';
import {extractUnit, extractValue, isEmptyValue, isValidNumber,} from '@/lib/ai-extraction/valueParser';
import {isSuggestionPending} from '@/lib/ai-extraction/suggestionUtils';
import {useJustUpdatedValue} from '@/hooks/extraction/useJustUpdatedValue';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface FieldInputProps {
  field: ExtractionField;
  instanceId: string;
  value: any;
  onChange: (value: any) => void;
  projectId: string;
  articleId: string;
  otherExtractions?: OtherExtraction[];
  aiSuggestion?: AISuggestion;
  onAcceptAI?: () => void;
  onRejectAI?: () => void;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  disabled?: boolean;
  viewMode?: 'extract' | 'compare';
}

// =================== COMPONENT ===================

export function FieldInput(props: FieldInputProps) {
  const { field, instanceId, value, onChange, disabled, otherExtractions, aiSuggestion, onAcceptAI, onRejectAI, getSuggestionsHistory, isActionLoading, viewMode } = props;
  const [validationError, setValidationError] = useState<string | null>(null);
  // Briefly highlights this field when its value was just updated (e.g. by an
  // AI extraction refresh) so the user sees what changed without having to
  // hunt the page for newly-populated cells.
  const justUpdated = useJustUpdatedValue(`${instanceId}_${field.id}`);

    // Fixed comfortable spacing
  const containerPadding = 'py-4';
  const inputHeight = 'h-9';
  const gap = 'gap-4';

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

    // Value to display: prefer state value (already updated after accept)
    // If no state value but there is accepted suggestion, show suggestion value
  const displayValue = !isEmptyValue(value)
    ? value
    : (hasAIAccepted && aiAcceptedValue !== null)
      ? aiAcceptedValue
      : '';

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

    // Render input by type
  const renderInput = () => {
    switch (field.field_type) {
      case 'text': {
          // Long description: use textarea (English keywords for label detection)
        const labelLower = field.label.toLowerCase();
          const isLongText = labelLower.includes('description') ||
              labelLower.includes('justification') ||
              labelLower.includes('comment') ||
              labelLower.includes('conclusion') ||
              labelLower.includes('conclusions') ||
              labelLower.includes('result') ||
              labelLower.includes('results') ||
              labelLower.includes('method') ||
              labelLower.includes('methods') ||
              labelLower.includes('analysis') ||
              labelLower.includes('analyses') ||
              labelLower.includes('discussion') ||
              labelLower.includes('observation') ||
              labelLower.includes('observations');
        
        if (isLongText) {
          return (
            <Textarea
              value={displayValue || ''}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={t('extraction', 'fieldPlaceholderEnter').replace('{{label}}', field.label.toLowerCase())}
              disabled={disabled}
              className={cn(
                  "text-sm min-h-[80px]",
                hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10",
                validationError && "border-destructive"
              )}
            />
          );
        }

        return (
          <Input
            value={displayValue || ''}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={t('extraction', 'fieldPlaceholderEnter').replace('{{label}}', field.label.toLowerCase())}
            disabled={disabled}
              className={cn(
                inputHeight,
                  "text-sm",
                hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10",
                validationError && "border-destructive"
              )}
          />
        );
      }

      case 'number': {
        // Parse valor (pode ser objeto {value, unit} ou valor simples)
        const numValue = extractValue(displayValue);
        const currentUnit = extractUnit(displayValue) 
          ?? (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit);

          // Prefer custom allowed_units over automatic dictionary
        const relatedUnits = field.allowed_units && field.allowed_units.length > 0
            ? field.allowed_units // Use units configured by manager (first is default)
            : (field.unit ? getRelatedUnits(field.unit) : []); // Fallback to automatic dictionary
        
        const hasMultipleUnits = relatedUnits.length > 0;

        return (
          <div className="flex gap-2">
            <Input
              type="number"
              value={numValue || ''}
              onChange={(e) => {
                if (hasMultipleUnits) {
                  handleChange({ value: e.target.value, unit: currentUnit || field.unit });
                } else {
                  handleChange(e.target.value);
                }
              }}
              placeholder="0"
              disabled={disabled}
              className={cn("flex-1", inputHeight, "text-sm", validationError && "border-destructive")}
            />

              {/* Unit selector when units are available */}
            {hasMultipleUnits ? (
              <Select
                value={currentUnit || ''}
                onValueChange={(newUnit) => {
                  handleChange({ value: numValue, unit: newUnit });
                }}
                disabled={disabled}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {/* All available units (allowed_units or related) */}
                  {relatedUnits.map((unit, index) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                      {index === 0 && field.allowed_units && field.allowed_units.length > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">{t('extraction', 'defaultUnit')}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit) ? (
                // Fixed badge when there are not multiple units but one is defined
              <Badge variant="outline" className="shrink-0 self-center">
                {field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit}
              </Badge>
            ) : null}
          </div>
        );
      }

      case 'date':
        return (
          <Input
            type="date"
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className={cn(inputHeight, "text-sm", validationError && "border-destructive")}
          />
        );

      case 'select': {
        const options = field.allowed_values as any[] || [];
        if (field.allow_other) {
          return (
            <SelectWithOther
              options={options}
              value={value || null}
              onChange={handleChange}
              allowOther={true}
              otherLabel={field.other_label || t('extraction', 'otherSpecifyDefault')}
              otherPlaceholder={field.other_placeholder || undefined}
              disabled={disabled}
              placeholder={t('extraction', 'selectFieldPlaceholder').replace('{{label}}', field.label.toLowerCase())}
              className={cn(validationError && 'border-destructive')}
            />
          );
        }
        return (
          <Select 
            value={value || ''} 
            onValueChange={handleChange} 
            disabled={disabled}
          >
            <SelectTrigger className={cn(inputHeight, "text-sm", validationError && "border-destructive")}>
                <SelectValue
                    placeholder={t('extraction', 'selectFieldPlaceholder').replace('{{label}}', field.label.toLowerCase())}/>
            </SelectTrigger>
            <SelectContent>
              {options.map((option: any, index: number) => {
                const optionValue = typeof option === 'string' ? option : option.value;
                const optionLabel = typeof option === 'string' ? option : option.label || option.value;
                return (
                  <SelectItem key={index} value={optionValue}>
                    {optionLabel}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );
      }

      case 'multiselect': {
        const mOptions = field.allowed_values as any[] || [];
        if (field.allow_other) {
          return (
            <MultiSelectWithOther
              options={mOptions}
              value={value || null}
              onChange={handleChange}
              allowOther={true}
              otherLabel={field.other_label || t('extraction', 'otherSpecifyDefault')}
              otherPlaceholder={field.other_placeholder || undefined}
              disabled={disabled}
              placeholder={t('extraction', 'selectFieldPlaceholder').replace('{{label}}', field.label.toLowerCase())}
            />
          );
        }
        // fallback simples
        return (
          <Input
            value={Array.isArray(value) ? value.join(', ') : value || ''}
            onChange={(e) => handleChange(e.target.value.split(',').map(v => v.trim()))}
            placeholder={t('extraction', 'valuesCommaSeparated')}
            disabled={disabled}
            className={cn(inputHeight, "text-sm", validationError && "border-destructive")}
          />
        );
      }

      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={value || false}
              onCheckedChange={handleChange}
              disabled={disabled}
            />
            <span className="text-sm text-muted-foreground">
              {value ? t('extraction', 'yes') : t('extraction', 'no')}
            </span>
          </div>
        );

      default:
        return (
          <Input
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className={cn(inputHeight, "text-sm", validationError && "border-destructive")}
          />
        );
    }
  };

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

  return (
      <div
          data-just-updated={justUpdated || undefined}
          className={cn(
            "grid grid-cols-[30%_1fr] items-start border-b border-border/40 last:border-b-0 transition-colors",
            justUpdated && "field-just-updated",
            gap,
            containerPadding
          )}>

      {/* Coluna esquerda: Label + Description */}
      <div className="space-y-1 pt-2">
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
                  {/* Collaboration badges - only in comparison mode */}
        {viewMode === 'compare' && otherExtractions && otherExtractions.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <OtherExtractionsPopover
              fieldId={field.id}
              instanceId={instanceId}
              extractions={otherExtractions}
              myValue={value}
            >
              <OtherExtractionsButton count={otherExtractions.length} />
            </OtherExtractionsPopover>
          </div>
        )}

                  {/* Input with badge + history on the right */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            {renderInput()}
          </div>
          
          <div className="flex items-center gap-1 shrink-0">
              {/* Badge + Info always visible on the right of input (if pending or accepted suggestion) */}
          {aiSuggestion && 
           (aiSuggestion.status === 'pending' || aiSuggestion.status === 'accepted') && (
            <AISuggestionBadge
              suggestion={aiSuggestion}
            />
          )}

              {/* History button - always visible if getHistory is provided */}
            {getSuggestionsHistory && aiSuggestion && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <AISuggestionHistoryPopover
                      instanceId={instanceId}
                      fieldId={field.id}
                      currentSuggestionId={aiSuggestion.id}
                      getHistory={getSuggestionsHistory}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn(
                            "h-7 w-7",
                            "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                          title={t('extraction', 'historySuggestionsAria')}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                      }
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Suggestion history</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

                  {/* Suggested value + accept/reject buttons below input - only when no manual value */}
        {shouldShowSuggestion && (
          <AISuggestionDisplay
            suggestion={aiSuggestion}
            instanceId={instanceId}
            fieldId={field.id}
            onAccept={onAcceptAI}
            onReject={onRejectAI}
            loading={isActionLoading ? isActionLoading(instanceId, field.id) === 'accept' || isActionLoading(instanceId, field.id) === 'reject' : false}
            getHistory={getSuggestionsHistory}
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

/**
 * Exports memoized version to avoid unnecessary re-renders
 *
 * Performance-critical: Only re-renders when THIS field's value changed
 * Soluciona bug de input perdendo foco a cada caractere
 */
export default memo(FieldInput, (prevProps, nextProps) => {
    // Optimized comparison: only props that affect THIS field
  const aiSuggestionChanged = prevProps.aiSuggestion?.id !== nextProps.aiSuggestion?.id ||
                                prevProps.aiSuggestion?.status !== nextProps.aiSuggestion?.status;
  
  return (
    prevProps.field.id === nextProps.field.id &&
    prevProps.instanceId === nextProps.instanceId &&
    prevProps.value === nextProps.value &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.viewMode === nextProps.viewMode &&
    !aiSuggestionChanged // Re-render when suggestion changes (status or ID)
  );
});

