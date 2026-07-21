/**
 * Typed consensus override editor — replaces the raw-JSON override box.
 *
 * Renders the shared FieldValueEditor for the field's type plus a universal
 * "No information" disposition toggle (ADR-0016) and an optional rationale.
 * It emits the FORM-SHAPED value (e.g. a scalar, `{value, unit}`, an array, or
 * the flat `{value: null, absent_reason}` marker); the caller applies
 * `toConsensusValueEnvelope` before POSTing so the payload is shape-identical
 * to a `select_existing` publish.
 */
import { useState } from 'react';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  FieldValueEditor,
  type FieldValueEditorField,
} from '@/components/extraction/FieldValueEditor';
import { isValueFilled, valueAbsentReason } from '@/lib/extraction/valueSemantics';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export interface ConsensusOverrideEditorProps {
  coordKey: string;
  field: FieldValueEditorField;
  disabled: boolean;
  /** Seed for "Change" on a resolved manual_override (form-shaped, unwrapped). */
  initialValue?: unknown;
  initialRationale?: string;
  onCancel: () => void;
  /** value = form-shaped editor output OR the flat marker envelope. */
  onPublish: (value: unknown, rationale: string) => Promise<void> | void;
}

export function ConsensusOverrideEditor({
  coordKey,
  field,
  disabled,
  initialValue,
  initialRationale,
  onCancel,
  onPublish,
}: ConsensusOverrideEditorProps) {
  const [value, setValue] = useState<unknown>(initialValue ?? '');
  const [rationale, setRationale] = useState(initialRationale ?? '');
  const markerActive = valueAbsentReason(value) !== null;

  return (
    <div
      className="space-y-2 rounded border border-dashed p-3"
      data-testid={`consensus-override-${coordKey}`}
    >
      <Label className="text-xs">{t('consensus', 'overrideValueLabel')}</Label>
      <FieldValueEditor
        field={field}
        value={markerActive ? '' : value}
        onChange={setValue}
        disabled={disabled || markerActive}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={markerActive}
          disabled={disabled}
          onClick={() =>
            setValue(
              markerActive ? '' : { value: null, absent_reason: 'no_information' },
            )
          }
          className={cn(
            'h-6 gap-1 px-2 text-xs',
            markerActive
              ? 'text-success ring-1 ring-inset ring-success bg-success/10 hover:bg-success/15 hover:text-success'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {markerActive ? <Check className="h-3 w-3" /> : null}
          {t('extraction', 'dispositionNoInformation')}
        </Button>
        {markerActive ? (
          <span className="text-[11px] text-muted-foreground">
            {t('consensus', 'overrideNoInfoRecorded')}
          </span>
        ) : null}
      </div>
      <Label htmlFor={`override-rationale-${coordKey}`} className="text-xs">
        {t('consensus', 'panelRationaleLabel')}
      </Label>
      <Textarea
        id={`override-rationale-${coordKey}`}
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder={t('consensus', 'panelRationalePlaceholder')}
        rows={2}
        disabled={disabled}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>
          {t('consensus', 'cancel')}
        </Button>
        <Button
          size="sm"
          disabled={disabled || !isValueFilled(value)}
          onClick={() => void onPublish(value, rationale.trim())}
          data-testid={`consensus-override-submit-${coordKey}`}
        >
          {t('consensus', 'panelPublishOverride')}
        </Button>
      </div>
    </div>
  );
}
