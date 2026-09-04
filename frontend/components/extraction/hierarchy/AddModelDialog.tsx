/**
 * Add Model Dialog — the model container's flavour of `AddEntryDialog`.
 *
 * The container is one entry group among others (identity spec §5.1): the
 * generic dialog owns the key input, the sibling chips and the duplicate
 * block; this composition adds the one model-specific extra — the optional
 * modelling method the manual endpoint records alongside the name — and
 * keeps the `(modelName, modellingMethod)` contract the page expects.
 *
 * `keyLabel` is the container's key field label (data); without one the
 * input falls back to the noun-generic "{{noun}} name" copy (B-8 D6).
 *
 * @component
 */

import {useState} from 'react';

import {AddEntryDialog} from '@/components/extraction/AddEntryDialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {t} from '@/lib/copy';
import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';

// =================== INTERFACES ===================

interface AddModelDialogProps {
  open: boolean;
  onConfirm: (modelName: string, modellingMethod: string) => Promise<void>;
  onCancel: () => void;
  existingModels: string[];
  /** Entry noun for `{{noun}}` copy interpolation (B-8 D6). */
  entryLabel?: string;
  /** Label of the container's key field; null/undefined → "{{noun}} name". */
  keyLabel?: string | null;
}

// =================== COMPONENT ===================

export function AddModelDialog({
  open,
  onConfirm,
  onCancel,
  existingModels,
  entryLabel = DEFAULT_ENTRY_NOUN,
  keyLabel,
}: AddModelDialogProps) {
  const [modellingMethod, setModellingMethod] = useState('');
  // Reset on close — adjusted during render instead of via effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setModellingMethod('');
  }
  // {{noun}} resolves inline at each call site (D7); the fallback label
  // uses the capitalized form.
  const nounCap = entryLabel.charAt(0).toUpperCase() + entryLabel.slice(1);

  return (
    <AddEntryDialog
      open={open}
      entryLabel={entryLabel}
      keyLabel={keyLabel ?? t('extraction', 'modelNameLabel').replace('{{noun}}', nounCap)}
      existingKeys={existingModels}
      onConfirm={(modelName) => onConfirm(modelName, modellingMethod.trim())}
      onCancel={onCancel}
    >
      <div className="space-y-2">
        <Label htmlFor="modelling-method">
          {t('extraction', 'modellingMethodLabel')}
          <span className="text-xs text-muted-foreground ml-1">
            {t('extraction', 'modellingMethodOptional')}
          </span>
        </Label>
        <Input
          id="modelling-method"
          placeholder={t('extraction', 'modelDescriptionPlaceholder')}
          value={modellingMethod}
          onChange={(e) => setModellingMethod(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('extraction', 'modellingMethodHint')}</p>
      </div>
    </AddEntryDialog>
  );
}
