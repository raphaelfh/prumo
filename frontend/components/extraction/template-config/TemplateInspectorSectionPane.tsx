/**
 * Section pane of the docked inspector (B-8 T6, D10) — extracted from
 * TemplateInspector.tsx when it outgrew the file-size ceiling.
 *
 * Three variants by `section.kind`. Every edit commits IMMEDIATELY
 * through the section PATCH (the Section-combobox semantics — no
 * draft/Save row):
 * - group: Repeats LOCKED ("a group always repeats");
 * - groupChild: Placement locked to the parent group, Repeats select
 *   (one/many). The D5 many→one 409 toasts the friendly copy in the
 *   hook and the select reverts here;
 * - root: Repeats READ-ONLY (cardinality is a create-time choice,
 *   spec §3).
 *
 * Every section that REPEATS — a group, or any other section with
 * cardinality 'many' — additionally shows the entry-group controls: the
 * entry-label Input (blur/Enter; an unchanged or emptied value is a
 * no-op that reverts the display — the header rename revert rule) and
 * the entry-key select (0059). One entry of a repeating section needs a
 * name and an identity whether or not it is the model container.
 *
 * The description is the section's AI instruction — sent with every
 * extraction of the section and, when it repeats, as the instruction for
 * identifying its entries; the run form never shows it. It commits on
 * blur like the entry label, except that a blank IS a commit (it clears).
 */
import {useState} from 'react';

import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {useUpdateTemplateSection} from '@/hooks/extraction/useUpdateTemplateSection';
import {t} from '@/lib/copy';

import {KIND_COPY, Label, ReadOnlyValue} from './inspectorShared';
import type {GridSection} from './templateTree';

/**
 * The key the pane remounts on — same contract as `fieldContentKey`: an
 * external edit (another editor, a refetch after a commit) re-derives
 * the shown values instead of leaving a stale local draft; the pane's
 * own successful commit converges because the refetch serves exactly
 * what the controls already show.
 */
export function sectionContentKey(section: GridSection): string {
  return JSON.stringify([
    section.id,
    section.label,
    section.entryNoun,
    section.ownEntryLabel,
    section.cardinality,
    section.description,
  ]);
}

/** What the entry-label input shows: the group's resolved noun (its
 * 'model' default is real server state), any other section's own raw
 * noun — or '' while unset, with the default noun as the placeholder. */
function shownEntryLabel(section: GridSection): string {
  return section.kind === 'group' ? section.entryNoun : (section.ownEntryLabel ?? '');
}

export function SectionInspectorForm({
  projectId,
  templateId,
  section,
  parentGroupLabel,
}: {
  projectId: string;
  templateId: string;
  section: GridSection;
  /** Label of the group owning a groupChild — the locked Placement line. */
  parentGroupLabel: string | null;
}) {
  const update = useUpdateTemplateSection(projectId, templateId);
  const updateFieldMutation = useUpdateTemplateField(projectId, templateId);
  const [entryLabel, setEntryLabel] = useState(shownEntryLabel(section));
  const [cardinality, setCardinality] = useState(section.cardinality);
  const [description, setDescription] = useState(section.description ?? '');

  // A group always repeats; a per-model section only when it says so.
  const repeats = section.kind === 'group' || cardinality === 'many';
  const entryKeyFieldId = section.fields.find((f) => f.isEntityKey)?.id ?? '';

  // Moving the key is clear-then-set: the API allows one per section and
  // refuses a second with a 409, so the previous holder is cleared first.
  const commitEntryKey = (nextFieldId: string) => {
    if (nextFieldId === entryKeyFieldId) return;
    const clearPrevious = entryKeyFieldId
      ? updateFieldMutation.mutateAsync({
          fieldId: entryKeyFieldId,
          updates: {is_entity_key: false},
        })
      : Promise.resolve();
    void clearPrevious.then(() => {
      if (!nextFieldId) return undefined;
      return updateFieldMutation.mutateAsync({
        fieldId: nextFieldId,
        updates: {is_entity_key: true},
      });
    });
  };
  // Own-save baseline (the field pane's contract): between a successful
  // commit and the refetch-driven remount the `section` prop is STALE —
  // comparing against it would swallow an immediate revert edit as a
  // no-op and snap the control back. Guards and error-reverts compare
  // against the last COMMITTED values instead; the remount on
  // sectionContentKey still reconciles external changes.
  const [lastCommitted, setLastCommitted] = useState({
    entryLabel: shownEntryLabel(section),
    cardinality: section.cardinality,
    description: section.description ?? '',
  });
  const saving = update.isPending;

  const commitEntryLabel = () => {
    const next = entryLabel.trim();
    if (next === '' || next === lastCommitted.entryLabel) {
      // No-op commit: revert the display, never call (mirrors the
      // grid header's rename revert rule).
      setEntryLabel(lastCommitted.entryLabel);
      return;
    }
    update.mutate(
      {sectionId: section.id, changes: {entry_label: next}},
      {
        onSuccess: () =>
          setLastCommitted((prev) => ({...prev, entryLabel: next})),
        // The hook toasted; an immediate-commit control shows server truth.
        onError: () => setEntryLabel(lastCommitted.entryLabel),
      },
    );
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next === lastCommitted.description) {
      // Whitespace-only edits normalize back; nothing to send.
      setDescription(lastCommitted.description);
      return;
    }
    // A blank goes through: the server clears the column.
    update.mutate(
      {sectionId: section.id, changes: {description: next}},
      {
        onSuccess: () =>
          setLastCommitted((prev) => ({...prev, description: next})),
        onError: () => setDescription(lastCommitted.description),
      },
    );
  };

  const commitCardinality = (value: string) => {
    const next = value === 'many' ? 'many' : 'one';
    if (next === lastCommitted.cardinality) return;
    setCardinality(next);
    update.mutate(
      {sectionId: section.id, changes: {cardinality: next}},
      {
        onSuccess: () =>
          setLastCommitted((prev) => ({...prev, cardinality: next})),
        onError: () => setCardinality(lastCommitted.cardinality),
      },
    );
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <strong className="min-w-0 flex-1 truncate">{section.label}</strong>
        <Badge variant="secondary" className="shrink-0 text-[11px]">
          {t('extraction', KIND_COPY[section.kind]).replace(
            '{{noun}}',
            section.entryNoun,
          )}
        </Badge>
      </div>
      {section.kind === 'group' && (
        <p className="mt-1 text-muted-foreground">
          {t('templateConfig', 'inspectorGroupKindLine').replace(
            '{{noun}}',
            section.entryNoun,
          )}
        </p>
      )}

      <Label>{t('extraction', 'inspectorKeyLabel')}</Label>
      <ReadOnlyValue muted>
        <span className="font-mono text-[11px]">{section.key}</span>
      </ReadOnlyValue>

      {section.kind === 'groupChild' && (
        <>
          <Label>{t('templateConfig', 'inspectorPlacementLabel')}</Label>
          <ReadOnlyValue muted>
            {t('templateConfig', 'inspectorInsideGroup').replace(
              '{{group}}',
              parentGroupLabel ?? '',
            )}
          </ReadOnlyValue>
        </>
      )}

      {repeats && (
        <>
          <Label htmlFor="inspector-section-entry-label">
            {t('templateConfig', 'entryLabelLabel')}
          </Label>
          <Input
            id="inspector-section-entry-label"
            value={entryLabel}
            onChange={(e) => setEntryLabel(e.target.value)}
            onBlur={commitEntryLabel}
            onKeyDown={(e) => {
              // Enter commits through the blur path (one commit).
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder={t(
              'templateConfig',
              section.kind === 'group' ? 'entryLabelPlaceholder' : 'entryLabelPlaceholderEntry',
            )}
            disabled={saving}
            className="h-7 text-[13px]"
          />
          <p className="mt-[3px] text-[11px] text-muted-foreground">
            {t('templateConfig', 'entryLabelHint')}
          </p>
        </>
      )}

      {section.kind === 'groupChild' ? (
        <>
          <Label htmlFor="inspector-section-repeats">
            {t('templateConfig', 'inspectorRepeatsLabel')}
          </Label>
          {/* Native select for the same reasons as the Section combobox:
              dense, keyboard-accessible, drivable in jsdom. */}
          <select
            id="inspector-section-repeats"
            value={cardinality}
            onChange={(e) => commitCardinality(e.target.value)}
            disabled={saving}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-[13px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="one">
              {t('templateConfig', 'cardinalityOncePerModel').replace(
                '{{noun}}',
                section.entryNoun,
              )}
            </option>
            <option value="many">
              {t('templateConfig', 'cardinalityRepeatsPerModel').replace(
                '{{noun}}',
                section.entryNoun,
              )}
            </option>
          </select>
        </>
      ) : (
        <>
          <Label>{t('templateConfig', 'inspectorRepeatsLabel')}</Label>
          <ReadOnlyValue muted>
            {section.kind === 'group'
              ? t('templateConfig', 'inspectorGroupAlwaysRepeats')
              : t(
                  'templateConfig',
                  section.cardinality === 'many'
                    ? 'repeatsPerArticle'
                    : 'repeatsOncePerArticle',
                )}
          </ReadOnlyValue>
        </>
      )}

      {/* 0059 — a repeating section needs an identity, or an AI re-run
          cannot tell a new entry from one it already extracted and the
          backend refuses rather than duplicating. Only rendered where it
          is meaningful: a group always repeats, a groupChild only when
          its cardinality says so. */}
      {repeats && (
        <>
          <Label htmlFor="inspector-entry-key">
            {t('templateConfig', 'inspectorEntryKeyLabel')}
          </Label>
          <div className="space-y-1">
            <select
              id="inspector-entry-key"
              value={entryKeyFieldId}
              onChange={(e) => commitEntryKey(e.target.value)}
              disabled={updateFieldMutation.isPending || section.fields.length === 0}
              className="h-7 w-full rounded-md border border-input bg-background px-2 text-[13px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t('templateConfig', 'inspectorEntryKeyNone')}</option>
              {section.fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('templateConfig', 'inspectorEntryKeyHint')}
            </p>
          </div>
        </>
      )}

      <Label>{t('extraction', 'fieldsCountLabel')}</Label>
      <ReadOnlyValue>{section.totalFieldCount}</ReadOnlyValue>

      <Label htmlFor="inspector-section-description">
        {t('templateConfig', 'inspectorSectionDescriptionLabel')}
      </Label>
      <Textarea
        id="inspector-section-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={commitDescription}
        placeholder={t('extraction', 'inspectorDescriptionEmpty')}
        disabled={saving}
        rows={3}
        className="text-[13px]"
      />
      <p className="mt-[3px] text-[11px] leading-snug text-muted-foreground">
        {t('templateConfig', 'sectionDescriptionHint')}
      </p>
    </>
  );
}
