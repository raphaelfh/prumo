import {useState} from 'react';
import {Pencil, Sparkles} from 'lucide-react';
import type {UseMutationResult} from '@tanstack/react-query';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import type {ExtractionField, ExtractionFieldUpdate} from '@/types/extraction';

import {AllowedValuesList} from '../dialogs/AllowedValuesList';
import type {GridField, GridSection} from './templateTree';

/**
 * Docked, non-modal inspector (spec §2).
 *
 * The field pane is an editable draft form for the common properties —
 * label, required, options, AI instruction, description — with one
 * explicit Save per edit session (same republish cadence as the dialog
 * it complements). Type/key/dispositions keep the "Edit field" escape
 * hatch: changing type drags in the whole validation machinery
 * (impact probe, revert-on-refuse), which stays in the dialog. Option
 * REORDER also stays in the dialog. Sections stay read-only here —
 * rename is already inline in the grid.
 */

export type UpdateFieldMutation = UseMutationResult<
  ExtractionField,
  Error,
  {fieldId: string; updates: ExtractionFieldUpdate}
>;

const KIND_COPY = {
  root: 'inspectorKindRoot',
  group: 'inspectorKindGroup',
  groupChild: 'inspectorKindGroupChild',
} as const;

const PANEL_CLASS =
  'w-[300px] shrink-0 overflow-y-auto border-l bg-muted/20 px-3.5 py-3 text-xs';

interface TemplateInspectorProps {
  field: GridField | null;
  section: GridSection | null;
  /** The section that owns the selected field, for the read-only Section row. */
  owningSection: GridSection | null;
  onEditField: (field: GridField) => void;
  updateField: UpdateFieldMutation;
  className?: string;
}

function Label({children, htmlFor}: {children: React.ReactNode; htmlFor?: string}) {
  const cls =
    'mb-[3px] mt-[9px] block text-[9.5px] uppercase tracking-[0.05em] text-muted-foreground';
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={cls}>
        {children}
      </label>
    );
  }
  return <div className={cls}>{children}</div>;
}

function ReadOnlyValue({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-background px-2 py-1 ${muted ? 'text-muted-foreground' : ''}`}
    >
      {children}
    </div>
  );
}

interface FieldDraft {
  label: string;
  isRequired: boolean;
  allowedValues: string[];
  aiInstruction: string;
  description: string;
}

function draftFromField(field: GridField): FieldDraft {
  return {
    label: field.label,
    isRequired: field.isRequired,
    allowedValues: field.allowedValues ?? [],
    aiInstruction: field.aiInstruction ?? '',
    description: field.description ?? '',
  };
}

function draftsEqual(a: FieldDraft, b: FieldDraft): boolean {
  return (
    a.label === b.label &&
    a.isRequired === b.isRequired &&
    a.aiInstruction === b.aiInstruction &&
    a.description === b.description &&
    a.allowedValues.length === b.allowedValues.length &&
    a.allowedValues.every((value, i) => value === b.allowedValues[i])
  );
}

/**
 * The key the form remounts on: the field's id PLUS the editable content.
 * A selection change resets the draft, and so does the same field's data
 * changing underneath (the "Edit field" dialog saving while this field
 * stays selected) — without the content in the key, a stale draft would
 * silently revert the dialog's edit on the next inspector Save. The
 * inspector's OWN save never flips the form: the baseline moves to the
 * saved values on success, so when the refetch lands the content key
 * re-derives to exactly what the form already shows. The cost is that an
 * external edit discards an in-progress draft — the safe resolution of a
 * two-editors race on one field.
 */
function fieldContentKey(field: GridField): string {
  return JSON.stringify([
    field.id,
    field.label,
    field.isRequired,
    field.allowedValues,
    field.aiInstruction,
    field.description,
  ]);
}


function FieldInspectorForm({
  field,
  owningSection,
  onEditField,
  updateField,
}: {
  field: GridField;
  owningSection: GridSection | null;
  onEditField: (field: GridField) => void;
  updateField: UpdateFieldMutation;
}) {
  const [baseline, setBaseline] = useState<FieldDraft>(() => draftFromField(field));
  const [draft, setDraft] = useState<FieldDraft>(baseline);

  const supportsOptions =
    field.fieldType === 'select' || field.fieldType === 'multiselect';
  const dirty = !draftsEqual(draft, baseline);
  const saving = updateField.isPending;
  const canSave = dirty && draft.label.trim() !== '' && !saving;

  const handleSave = () => {
    const normalized: FieldDraft = {
      label: draft.label.trim(),
      isRequired: draft.isRequired,
      allowedValues: draft.allowedValues,
      aiInstruction: draft.aiInstruction.trim(),
      description: draft.description.trim(),
    };
    const updates: ExtractionFieldUpdate = {
      label: normalized.label,
      is_required: normalized.isRequired,
      // Zod wants min(1) when present — an emptied list collapses to null.
      allowed_values: supportsOptions
        ? normalized.allowedValues.length > 0
          ? normalized.allowedValues
          : null
        : (field.allowedValues ?? null),
      llm_description:
        normalized.aiInstruction === '' ? null : normalized.aiInstruction,
      description: normalized.description === '' ? null : normalized.description,
    };
    updateField.mutate(
      {fieldId: field.id, updates},
      {
        onSuccess: () => {
          setBaseline(normalized);
          setDraft(normalized);
        },
      },
    );
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <strong className="min-w-0 flex-1 truncate">{field.label}</strong>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={() => onEditField(field)}
        >
          <Pencil className="mr-1 size-3" aria-hidden />
          {t('extraction', 'inspectorEditButton')}
        </Button>
      </div>

      <Label htmlFor="inspector-field-label">
        {t('extraction', 'inspectorLabelLabel')}
      </Label>
      <Input
        id="inspector-field-label"
        value={draft.label}
        onChange={(e) => setDraft({...draft, label: e.target.value})}
        disabled={saving}
        className="h-7 text-xs"
      />

      <Label>{t('extraction', 'inspectorKeyLabel')}</Label>
      <ReadOnlyValue muted>
        <span className="font-mono text-[10px]">{field.key}</span>
      </ReadOnlyValue>

      {owningSection && (
        <>
          <Label>{t('extraction', 'inspectorSectionLabel')}</Label>
          <ReadOnlyValue>{owningSection.label}</ReadOnlyValue>
        </>
      )}

      <Label>{t('extraction', 'inspectorTypeLabel')}</Label>
      <ReadOnlyValue>
        <span className="capitalize">{field.fieldType}</span>
        {field.unit && (
          <span className="ml-1.5 text-muted-foreground">· {field.unit}</span>
        )}
      </ReadOnlyValue>
      <p className="mt-[3px] text-[10.5px] text-muted-foreground">
        {t('extraction', 'inspectorTypeHint')}
      </p>

      <Label htmlFor="inspector-field-required">
        {t('extraction', 'inspectorRequiredLabel')}
      </Label>
      <div className="flex items-center justify-between rounded-md border bg-background px-2 py-1.5">
        <span className={draft.isRequired ? '' : 'text-muted-foreground'}>
          {draft.isRequired
            ? t('extraction', 'inspectorRequiredYes')
            : t('extraction', 'inspectorRequiredNo')}
        </span>
        <Switch
          id="inspector-field-required"
          checked={draft.isRequired}
          onCheckedChange={(checked) =>
            setDraft({...draft, isRequired: checked})
          }
          disabled={saving}
          aria-label={t('extraction', 'inspectorRequiredSwitch')}
        />
      </div>

      {supportsOptions && (
        <>
          <Label>{t('extraction', 'inspectorOptionsLabel')}</Label>
          <AllowedValuesList
            values={draft.allowedValues}
            onChange={(values) => setDraft({...draft, allowedValues: values})}
            disabled={saving}
            showReorder={false}
          />
        </>
      )}

      <Label htmlFor="inspector-field-ai">
        <span className="inline-flex items-center gap-1 text-primary">
          <Sparkles className="size-3" aria-hidden />
          {t('extraction', 'inspectorAiLabel')}
        </span>
      </Label>
      <Textarea
        id="inspector-field-ai"
        value={draft.aiInstruction}
        onChange={(e) => setDraft({...draft, aiInstruction: e.target.value})}
        placeholder={t('extraction', 'inspectorAiEmpty')}
        disabled={saving}
        rows={3}
        className="text-xs"
      />
      <p className="mt-[3px] text-[10.5px] text-muted-foreground">
        {t('extraction', 'inspectorAiHint')}
      </p>

      <Label htmlFor="inspector-field-description">
        {t('extraction', 'inspectorDescriptionLabel')}
      </Label>
      <Textarea
        id="inspector-field-description"
        value={draft.description}
        onChange={(e) => setDraft({...draft, description: e.target.value})}
        placeholder={t('extraction', 'inspectorDescriptionEmpty')}
        disabled={saving}
        rows={2}
        className="text-xs"
      />
      <p className="mt-[3px] text-[10.5px] text-muted-foreground">
        {t('extraction', 'inspectorDescriptionHint')}
      </p>

      <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => setDraft(baseline)}
          disabled={!dirty || saving}
        >
          {t('extraction', 'inspectorReset')}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7"
          onClick={handleSave}
          disabled={!canSave}
        >
          {t('extraction', 'inspectorSave')}
        </Button>
      </div>
    </>
  );
}

export function TemplateInspector({
  field,
  section,
  owningSection,
  onEditField,
  updateField,
  className,
}: TemplateInspectorProps) {
  if (!field && !section) {
    return (
      <aside className={cn(PANEL_CLASS, className)}>
        <div className="font-medium">{t('extraction', 'inspectorEmptyTitle')}</div>
        <p className="mt-1 text-muted-foreground">
          {t('extraction', 'inspectorEmptyHint')}
        </p>
      </aside>
    );
  }

  if (field) {
    return (
      <aside
        data-testid="template-inspector"
        className={cn(PANEL_CLASS, className)}
      >
        <FieldInspectorForm
          key={fieldContentKey(field)}
          field={field}
          owningSection={owningSection}
          onEditField={onEditField}
          updateField={updateField}
        />
      </aside>
    );
  }

  const selectedSection = section as GridSection;
  return (
    <aside
      data-testid="template-inspector"
      className={cn(PANEL_CLASS, className)}
    >
      <div className="flex items-center gap-1.5">
        <strong className="min-w-0 flex-1 truncate">{selectedSection.label}</strong>
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {t('extraction', KIND_COPY[selectedSection.kind])}
        </Badge>
      </div>

      <Label>{t('extraction', 'inspectorKeyLabel')}</Label>
      <ReadOnlyValue muted>
        <span className="font-mono text-[10px]">{selectedSection.key}</span>
      </ReadOnlyValue>

      <Label>{t('extraction', 'fieldsCountLabel')}</Label>
      <ReadOnlyValue>{selectedSection.totalFieldCount}</ReadOnlyValue>

      <Label>{t('extraction', 'inspectorDescriptionLabel')}</Label>
      <ReadOnlyValue muted={!selectedSection.description}>
        {selectedSection.description ?? t('extraction', 'inspectorDescriptionEmpty')}
      </ReadOnlyValue>
    </aside>
  );
}
