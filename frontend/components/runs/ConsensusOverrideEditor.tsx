/**
 * Typed consensus override editor — replaces the raw-JSON override box.
 *
 * Renders the shared FieldValueEditor for the field's type plus the shared
 * DispositionRow (ADR-0016 — the same chips the extraction form offers, gated
 * by the same per-field flags) and an optional rationale.
 * It emits the FORM-SHAPED value (e.g. a scalar, `{value, unit}`, an array, or
 * the flat `{value: null, absent_reason}` marker); the caller applies
 * `toConsensusValueEnvelope` before POSTing so the payload is shape-identical
 * to a `select_existing` publish.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  FieldValueEditor,
  type FieldValueEditorField,
} from '@/components/extraction/FieldValueEditor';
import {
  DispositionRow,
  type DispositionRowField,
} from '@/components/extraction/DispositionRow';
import { isValueFilled, valueAbsentReason } from '@/lib/extraction/valueSemantics';
import { t } from '@/lib/copy';

export interface ConsensusOverrideEditorProps {
  coordKey: string;
  /** Carries the typed-editor attributes AND the ADR-0016 disposition flags —
   *  one field object, so a new flag reaches both controls at once. */
  field: FieldValueEditorField & DispositionRowField;
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
  // Always false while `allowsNoInformation` is off: the caller drops a marker
  // from `overrideSeed`, and with the toggle hidden nothing can set one. If that
  // ever changes, the editor would open disabled with no control to clear it.
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
      <DispositionRow
        field={field}
        value={value}
        onChange={setValue}
        disabled={disabled}
        activeHint={t('consensus', 'overrideDispositionRecorded')}
      />
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
