/**
 * Pure type-dispatched value editor — the input core of FieldInput, extracted
 * so non-form surfaces (the consensus override) can edit a typed value without
 * the AI chrome or the RunEditabilityContext coupling (which is read-only
 * during consensus and would disable a reused FieldInput).
 *
 * Emits exactly what the extraction form emits per field type, so any
 * consumer's payload is shape-identical to a reviewer's decision value:
 *   text     → string
 *   number   → string, or {value, unit} when the field carries units
 *   date     → 'YYYY-MM-DD' string
 *   select   → string (or an "other" object via SelectWithOther)
 *   multiselect → string[] (or an "other" object via MultiSelectWithOther)
 *   boolean  → boolean
 *   unknown  → string
 *
 * @component
 */

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SelectWithOther } from '@/components/ui/SelectWithOther';
import { MultiSelectWithOther } from '@/components/ui/MultiSelectWithOther';
import { Switch } from '@/components/ui/switch';
import { getRelatedUnits } from '@/lib/unitConversions';
import { extractUnit, extractValue } from '@/lib/ai-extraction/valueParser';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export interface FieldValueEditorField {
  id: string;
  label: string;
  field_type: string;
  allowed_values?: unknown;
  unit?: string | null;
  allowed_units?: string[] | null;
  allow_other?: boolean;
  other_label?: string | null;
  other_placeholder?: string | null;
}

export interface FieldValueEditorProps {
  field: FieldValueEditorField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  /** Extra classes on every input variant (e.g. a validation border). */
  inputClassName?: string;
  /** Extra classes on the text/textarea variant only (AI-pending accent parity). */
  textAccentClassName?: string;
}

export function FieldValueEditor({
  field,
  value,
  onChange,
  disabled,
  inputClassName,
  textAccentClassName,
}: FieldValueEditorProps) {
  const inputHeight = 'h-8';

  switch (field.field_type) {
    case 'text': {
      // Long description: use textarea (English keywords for label detection)
      const labelLower = field.label.toLowerCase();
      const isLongText =
        labelLower.includes('description') ||
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
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('extraction', 'fieldPlaceholderEnter').replace(
              '{{label}}',
              field.label.toLowerCase(),
            )}
            disabled={disabled}
            className={cn('text-sm min-h-[80px]', textAccentClassName, inputClassName)}
          />
        );
      }

      return (
        <Input
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('extraction', 'fieldPlaceholderEnter').replace(
            '{{label}}',
            field.label.toLowerCase(),
          )}
          disabled={disabled}
          className={cn(inputHeight, 'text-sm', textAccentClassName, inputClassName)}
        />
      );
    }

    case 'number': {
      const numValue = extractValue(value);
      const currentUnit =
        extractUnit(value) ??
        (field.allowed_units && field.allowed_units.length > 0
          ? field.allowed_units[0]
          : field.unit);

      // Prefer custom allowed_units over automatic dictionary
      const relatedUnits =
        field.allowed_units && field.allowed_units.length > 0
          ? field.allowed_units // Use units configured by manager (first is default)
          : field.unit
            ? getRelatedUnits(field.unit) // Fallback to automatic dictionary
            : [];

      const hasMultipleUnits = relatedUnits.length > 0;

      return (
        <div className="flex gap-2">
          <Input
            type="number"
            value={numValue || ''}
            onChange={(e) => {
              if (hasMultipleUnits) {
                onChange({ value: e.target.value, unit: currentUnit || field.unit });
              } else {
                onChange(e.target.value);
              }
            }}
            placeholder="0"
            disabled={disabled}
            className={cn('flex-1', inputHeight, 'text-sm', inputClassName)}
          />

          {/* Unit selector when units are available */}
          {hasMultipleUnits ? (
            <Select
              value={currentUnit || ''}
              onValueChange={(newUnit) => {
                onChange({ value: numValue, unit: newUnit });
              }}
              disabled={disabled}
            >
              <SelectTrigger className="w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {relatedUnits.map((unit, index) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                    {index === 0 &&
                      field.allowed_units &&
                      field.allowed_units.length > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {t('extraction', 'defaultUnit')}
                        </span>
                      )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
              field.allowed_units && field.allowed_units.length > 0
                ? field.allowed_units[0]
                : field.unit
            ) ? (
            <Badge variant="outline" className="shrink-0 self-center">
              {field.allowed_units && field.allowed_units.length > 0
                ? field.allowed_units[0]
                : field.unit}
            </Badge>
          ) : null}
        </div>
      );
    }

    case 'date':
      return (
        <Input
          type="date"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(inputHeight, 'text-sm', inputClassName)}
        />
      );

    case 'select': {
      const options = (field.allowed_values as any[]) || [];
      if (field.allow_other) {
        return (
          <SelectWithOther
            options={options}
            value={(value as any) || null}
            onChange={onChange}
            allowOther={true}
            otherLabel={field.other_label || t('extraction', 'otherSpecifyDefault')}
            otherPlaceholder={field.other_placeholder || undefined}
            disabled={disabled}
            placeholder={t('extraction', 'selectFieldPlaceholder').replace(
              '{{label}}',
              field.label.toLowerCase(),
            )}
            className={cn(inputClassName)}
          />
        );
      }
      return (
        <Select
          // Guarded rather than cast: a marker envelope ({value:null,
          // absent_reason}) is an OBJECT, and an object is truthy, so `|| ''`
          // let it through as Radix's controlled value — which suppressed the
          // placeholder and rendered an empty box with no selection at all.
          value={typeof value === 'string' ? value : ''}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger className={cn(inputHeight, 'text-sm', inputClassName)}>
            <SelectValue
              placeholder={t('extraction', 'selectFieldPlaceholder').replace(
                '{{label}}',
                field.label.toLowerCase(),
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((option: any, index: number) => {
              const optionValue = typeof option === 'string' ? option : option.value;
              const optionLabel =
                typeof option === 'string' ? option : option.label || option.value;
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
      const mOptions = (field.allowed_values as any[]) || [];
      if (field.allow_other) {
        return (
          <MultiSelectWithOther
            options={mOptions}
            value={(value as any) || null}
            onChange={onChange}
            allowOther={true}
            otherLabel={field.other_label || t('extraction', 'otherSpecifyDefault')}
            otherPlaceholder={field.other_placeholder || undefined}
            disabled={disabled}
            placeholder={t('extraction', 'selectFieldPlaceholder').replace(
              '{{label}}',
              field.label.toLowerCase(),
            )}
          />
        );
      }
      // Simple comma-separated fallback
      return (
        <Input
          value={Array.isArray(value) ? value.join(', ') : (value as string) || ''}
          onChange={(e) => onChange(e.target.value.split(',').map((v) => v.trim()))}
          placeholder={t('extraction', 'valuesCommaSeparated')}
          disabled={disabled}
          className={cn(inputHeight, 'text-sm', inputClassName)}
        />
      );
    }

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={(value as boolean) || false}
            onCheckedChange={onChange}
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
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(inputHeight, 'text-sm', inputClassName)}
        />
      );
  }
}
