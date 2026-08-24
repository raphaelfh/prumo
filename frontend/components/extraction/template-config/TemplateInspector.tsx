import {useState} from 'react';
import {Sparkles} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import type {ExtractionFieldUpdate} from '@/types/extraction';

import {AllowedUnitsList} from '../dialogs/AllowedUnitsList';
import {AllowedValuesList} from '../dialogs/AllowedValuesList';
import {Label, ReadOnlyValue} from './inspectorShared';
import {
  SectionInspectorForm,
  sectionContentKey,
} from './TemplateInspectorSectionPane';
import {
  FIELD_TYPE_OPTIONS,
  type GridField,
  type GridSection,
  type MoveTargetSection,
} from './templateTree';

/**
 * Docked, non-modal inspector (spec §2).
 *
 * Since B-5 Task 5 the field pane is the FULL editor: every capability
 * the field dialogs held is absorbed here — type (with the impact probe
 * running in the panel's save routing), units, option reorder,
 * allow-other and its label/placeholder, and the ADR-0016 dispositions —
 * because Task 8 deletes those dialogs. One explicit Save per edit
 * session; the write path is the panel's (`onSaveField` routes real rows
 * through the update mutation and PENDING optimistic rows through the
 * insert queue). Sections stay read-only here — rename is already inline
 * in the grid. Exception (B-6 T4): the field pane's Section row is the
 * accessible MOVE combobox — an immediate structural action through the
 * panel's move dispatcher, never part of the draft.
 *
 * B-8 T6 (D10): the SECTION pane grows the spec's edit affordances —
 * entry label (groups) and Repeats (per-model sections) — as
 * IMMEDIATE-commit controls through `useUpdateTemplateSection` (the
 * Section-combobox semantics: structural, no draft/Save row). Root
 * sections stay read-only (cardinality is a create-time choice).
 */

/** Deep-link target from the grid's ✨/Options cells: remounts the form
 * (seq) and focuses the group's editor. */
export interface InspectorFocusGroup {
  group: 'ai' | 'options';
  seq: number;
}

/** Panel-owned save routing: real rows → update mutation (probe first on
 * type changes), pending rows → insert queue. `onSaved` moves the form
 * baseline once the write is accepted. */
export type SaveFieldHandler = (
  field: GridField,
  updates: ExtractionFieldUpdate,
  onSaved: () => void,
) => void;

const PANEL_CLASS =
  'w-[300px] shrink-0 overflow-y-auto border-l bg-muted/20 px-3.5 py-3 text-xs';

interface TemplateInspectorProps {
  /** Section-pane commit context (B-8 T6) — the immediate PATCH needs
   * the route ids the panel already holds. */
  projectId: string;
  templateId: string;
  field: GridField | null;
  section: GridSection | null;
  /** The section that owns the selected field — the combobox's value. */
  owningSection: GridSection | null;
  /** Label of the group owning a selected groupChild — the locked
   * Placement line (null for roots/groups/fields). */
  parentGroupLabel: string | null;
  onSaveField: SaveFieldHandler;
  /** True while the panel's update mutation is in flight. */
  saving: boolean;
  /** Destinations for the Section combobox (current template only). */
  sections: MoveTargetSection[];
  /** Section combobox pick (B-6 T4) — commits IMMEDIATELY as its own
   * move action through the panel's dispatcher (the Type menu's
   * semantics), never through the form draft. The panel supplies the
   * end-of-destination index and calls `moveFieldTo`. */
  onMoveField: (field: GridField, toSectionId: string) => void;
  /** True on PENDING rows — no server id to move yet (delete's gating). */
  moveDisabled: boolean;
  /** Deep-link from the grid; only forwarded when it targets `field`. */
  focusGroup?: InspectorFocusGroup | null;
  className?: string;
}

/** Compact switch row for the boolean toggles (dispositions, allow-other). */
function SwitchRow({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5">
      <label htmlFor={id} className={checked ? '' : 'text-muted-foreground'}>
        {label}
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

interface FieldDraft {
  label: string;
  fieldType: string;
  isRequired: boolean;
  allowedValues: string[];
  allowedUnits: string[];
  allowOther: boolean;
  otherLabel: string;
  otherPlaceholder: string;
  allowsNotApplicable: boolean;
  allowsNotEvaluated: boolean;
  aiInstruction: string;
  description: string;
}

function draftFromField(field: GridField): FieldDraft {
  return {
    label: field.label,
    fieldType: field.fieldType,
    isRequired: field.isRequired,
    allowedValues: field.allowedValues ?? [],
    allowedUnits: field.allowedUnits ?? [],
    allowOther: field.allowOther,
    otherLabel: field.otherLabel ?? '',
    otherPlaceholder: field.otherPlaceholder ?? '',
    allowsNotApplicable: field.allowsNotApplicable,
    allowsNotEvaluated: field.allowsNotEvaluated,
    aiInstruction: field.aiInstruction ?? '',
    description: field.description ?? '',
  };
}

function listsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function draftsEqual(a: FieldDraft, b: FieldDraft): boolean {
  return (
    a.label === b.label &&
    a.fieldType === b.fieldType &&
    a.isRequired === b.isRequired &&
    a.allowOther === b.allowOther &&
    a.otherLabel === b.otherLabel &&
    a.otherPlaceholder === b.otherPlaceholder &&
    a.allowsNotApplicable === b.allowsNotApplicable &&
    a.allowsNotEvaluated === b.allowsNotEvaluated &&
    a.aiInstruction === b.aiInstruction &&
    a.description === b.description &&
    listsEqual(a.allowedValues, b.allowedValues) &&
    listsEqual(a.allowedUnits, b.allowedUnits)
  );
}

function supportsOptionsType(fieldType: string): boolean {
  return fieldType === 'select' || fieldType === 'multiselect';
}

/**
 * The key the form remounts on: the field's id PLUS the editable content.
 * A selection change resets the draft, and so does the same field's data
 * changing underneath (another editor saving while this field stays
 * selected) — without the content in the key, a stale draft would
 * silently revert that edit on the next inspector Save. The inspector's
 * OWN save never flips the form: the baseline moves to the saved values
 * on success, so when the refetch lands the content key re-derives to
 * exactly what the form already shows. The cost is that an external edit
 * discards an in-progress draft — the safe resolution of a two-editors
 * race on one field.
 *
 * `entityTypeId` joins the key (B-6 T4) so a grid-side MOVE remounts the
 * form too — the combobox value and the owning-section context must
 * re-derive when the field lands in another section.
 */
function fieldContentKey(field: GridField): string {
  return JSON.stringify([
    field.id,
    field.entityTypeId,
    field.label,
    field.fieldType,
    field.isRequired,
    field.allowedValues,
    field.allowedUnits,
    field.allowOther,
    field.otherLabel,
    field.otherPlaceholder,
    field.allowsNotApplicable,
    field.allowsNotEvaluated,
    field.aiInstruction,
    field.description,
  ]);
}

function FieldInspectorForm({
  field,
  owningSection,
  onSaveField,
  saving,
  sections,
  onMoveField,
  moveDisabled,
  focusGroup,
}: {
  field: GridField;
  owningSection: GridSection | null;
  onSaveField: SaveFieldHandler;
  saving: boolean;
  sections: MoveTargetSection[];
  onMoveField: (field: GridField, toSectionId: string) => void;
  moveDisabled: boolean;
  focusGroup: 'ai' | 'options' | null;
}) {
  const [baseline, setBaseline] = useState<FieldDraft>(() => draftFromField(field));
  const [draft, setDraft] = useState<FieldDraft>(baseline);

  const supportsOptions = supportsOptionsType(draft.fieldType);
  const isNumber = draft.fieldType === 'number';
  const dirty = !draftsEqual(draft, baseline);
  const canSave = dirty && draft.label.trim() !== '' && !saving;

  const handleSave = () => {
    // Type-dependent groups collapse with the DRAFT type (the dialog's
    // semantics): options/allow-other only survive select kinds, units
    // only numbers.
    const normalized: FieldDraft = {
      ...draft,
      label: draft.label.trim(),
      allowedValues: supportsOptions ? draft.allowedValues : [],
      allowedUnits: isNumber ? draft.allowedUnits : [],
      allowOther: supportsOptions ? draft.allowOther : false,
      otherLabel: supportsOptions && draft.allowOther ? draft.otherLabel.trim() : '',
      otherPlaceholder:
        supportsOptions && draft.allowOther ? draft.otherPlaceholder.trim() : '',
      aiInstruction: draft.aiInstruction.trim(),
      description: draft.description.trim(),
    };
    const updates: ExtractionFieldUpdate = {
      label: normalized.label,
      field_type: normalized.fieldType as ExtractionFieldUpdate['field_type'],
      is_required: normalized.isRequired,
      // Zod wants min(1) when present — an emptied list collapses to null.
      allowed_values:
        normalized.allowedValues.length > 0 ? normalized.allowedValues : null,
      allow_other: normalized.allowOther,
      other_label: normalized.otherLabel === '' ? null : normalized.otherLabel,
      other_placeholder:
        normalized.otherPlaceholder === '' ? null : normalized.otherPlaceholder,
      allowed_units:
        normalized.allowedUnits.length > 0 ? normalized.allowedUnits : null,
      // The first allowed unit is the default (the dialog kept them in sync).
      unit: normalized.allowedUnits.length > 0 ? normalized.allowedUnits[0] : null,
      allows_not_applicable: normalized.allowsNotApplicable,
      allows_not_evaluated: normalized.allowsNotEvaluated,
      llm_description:
        normalized.aiInstruction === '' ? null : normalized.aiInstruction,
      description: normalized.description === '' ? null : normalized.description,
    };
    onSaveField(field, updates, () => {
      setBaseline(normalized);
      setDraft(normalized);
    });
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <strong className="min-w-0 flex-1 truncate">{field.label}</strong>
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
          <Label htmlFor="inspector-field-section">
            {t('extraction', 'inspectorSectionLabel')}
          </Label>
          {/* The accessible MOVE mechanism (B-6 T4, panel decision 2):
              a pick commits immediately as its own move action — it
              never joins the form draft, so Save/Reset stay untouched.
              Native select for the same reason as the type select. */}
          <select
            id="inspector-field-section"
            value={owningSection.id}
            onChange={(e) => onMoveField(field, e.target.value)}
            disabled={saving || moveDisabled}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.kind === 'groupChild' ? `\u00A0\u00A0${s.label}` : s.label}
              </option>
            ))}
          </select>
        </>
      )}

      <Label htmlFor="inspector-field-type">
        {t('extraction', 'inspectorTypeLabel')}
      </Label>
      {/* Native select on purpose: dense, fully keyboard-accessible, and
          the only Radix-free way to keep this form drivable in jsdom. */}
      <select
        id="inspector-field-type"
        value={draft.fieldType}
        onChange={(e) => setDraft({...draft, fieldType: e.target.value})}
        disabled={saving}
        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {FIELD_TYPE_OPTIONS.map(({value, copyKey}) => (
          <option key={value} value={value}>
            {t('extraction', copyKey)}
          </option>
        ))}
      </select>
      {/* Nothing BLOCKS a type change: update_field has no such guard, and
          B-9b2b deliberately chose ack-over-block — it lands as a DESTRUCTIVE
          row needing a per-item confirmation at Publish. The hint used to say
          "blocked", promising a guarantee the product does not make. Blocking
          would also be the wrong product: a field typed `text` that should
          have been `number` is exactly the correction a manager needs. */}
      <p className="mt-[3px] text-[10.5px] text-muted-foreground">
        {t('extraction', 'inspectorTypeChangeHint')}
      </p>

      {isNumber && (
        <>
          <Label>{t('extraction', 'inspectorUnitsLabel')}</Label>
          <AllowedUnitsList
            values={draft.allowedUnits}
            onChange={(units) => setDraft({...draft, allowedUnits: units})}
            disabled={saving}
          />
          <p className="mt-[3px] text-[10.5px] text-muted-foreground">
            {t('extraction', 'inspectorUnitsHint')}
          </p>
        </>
      )}

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
            showReorder
            autoFocusInput={focusGroup === 'options'}
          />
          <div className="mt-1.5">
            <SwitchRow
              id="inspector-field-allow-other"
              label={t('extraction', 'allowOtherSpecifyLabel')}
              checked={draft.allowOther}
              disabled={saving}
              onCheckedChange={(checked) =>
                setDraft({...draft, allowOther: checked})
              }
            />
          </div>
          {draft.allowOther && (
            <>
              <Label htmlFor="inspector-field-other-label">
                {t('extraction', 'otherLabelLabel')}
              </Label>
              <Input
                id="inspector-field-other-label"
                value={draft.otherLabel}
                onChange={(e) => setDraft({...draft, otherLabel: e.target.value})}
                placeholder={t('extraction', 'otherSpecifyDefault')}
                disabled={saving}
                className="h-7 text-xs"
              />
              <Label htmlFor="inspector-field-other-placeholder">
                {t('extraction', 'placeholderLabel')}
              </Label>
              <Input
                id="inspector-field-other-placeholder"
                value={draft.otherPlaceholder}
                onChange={(e) =>
                  setDraft({...draft, otherPlaceholder: e.target.value})
                }
                placeholder={t('extraction', 'placeholderTypeHere')}
                disabled={saving}
                className="h-7 text-xs"
              />
            </>
          )}
        </>
      )}

      <Label>{t('extraction', 'inspectorDispositionsLabel')}</Label>
      <div className="space-y-1.5">
        <SwitchRow
          id="inspector-field-not-applicable"
          label={t('extraction', 'dispositionAllowNotApplicableLabel')}
          checked={draft.allowsNotApplicable}
          disabled={saving}
          onCheckedChange={(checked) =>
            setDraft({...draft, allowsNotApplicable: checked})
          }
        />
        <SwitchRow
          id="inspector-field-not-evaluated"
          label={t('extraction', 'dispositionAllowNotEvaluatedLabel')}
          checked={draft.allowsNotEvaluated}
          disabled={saving}
          onCheckedChange={(checked) =>
            setDraft({...draft, allowsNotEvaluated: checked})
          }
        />
      </div>
      <p className="mt-[3px] text-[10.5px] text-muted-foreground">
        {t('extraction', 'dispositionBuilderHint')}
      </p>

      <Label htmlFor="inspector-field-ai">
        <span className="inline-flex items-center gap-1 text-primary">
          <Sparkles className="size-3" aria-hidden />
          {t('extraction', 'inspectorAiLabel')}
        </span>
      </Label>
      <Textarea
        id="inspector-field-ai"
        value={draft.aiInstruction}
        autoFocus={focusGroup === 'ai'}
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
  projectId,
  templateId,
  field,
  section,
  owningSection,
  parentGroupLabel,
  onSaveField,
  saving,
  sections,
  onMoveField,
  moveDisabled,
  focusGroup,
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
          // The deep-link seq joins the key so a repeated ✨ click re-runs
          // the group focus even when the content hasn't changed.
          key={`${fieldContentKey(field)}:${focusGroup?.seq ?? 0}`}
          field={field}
          owningSection={owningSection}
          onSaveField={onSaveField}
          saving={saving}
          sections={sections}
          onMoveField={onMoveField}
          moveDisabled={moveDisabled}
          focusGroup={focusGroup?.group ?? null}
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
      <SectionInspectorForm
        // Content-keyed remount (B-8 T6): an external edit re-derives
        // the entry-label/Repeats controls, like fieldContentKey above.
        key={sectionContentKey(selectedSection)}
        projectId={projectId}
        templateId={templateId}
        section={selectedSection}
        parentGroupLabel={parentGroupLabel}
      />
    </aside>
  );
}
