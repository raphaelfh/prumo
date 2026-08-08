/**
 * Section pane of the docked inspector (B-8 T6, D10) — extracted from
 * TemplateInspector.tsx when it outgrew the file-size ceiling.
 *
 * Three variants by `section.kind`. Every edit commits IMMEDIATELY
 * through the section PATCH (the Section-combobox semantics — no
 * draft/Save row):
 * - group: entry-label Input (blur/Enter; unchanged or emptied value is
 *   a no-op that reverts the display — the header rename revert rule),
 *   Repeats LOCKED ("a group always repeats");
 * - groupChild: Placement locked to the parent group, Repeats select
 *   (one/many). The D5 many→one 409 toasts the friendly copy in the
 *   hook and the select reverts here;
 * - root: Repeats READ-ONLY (cardinality is a create-time choice,
 *   spec §3).
 */
import {useState} from 'react';

import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
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
    section.cardinality,
  ]);
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
  const [entryLabel, setEntryLabel] = useState(section.entryNoun);
  const [cardinality, setCardinality] = useState(section.cardinality);
  // Own-save baseline (the field pane's contract): between a successful
  // commit and the refetch-driven remount the `section` prop is STALE —
  // comparing against it would swallow an immediate revert edit as a
  // no-op and snap the control back. Guards and error-reverts compare
  // against the last COMMITTED values instead; the remount on
  // sectionContentKey still reconciles external changes.
  const [lastCommitted, setLastCommitted] = useState({
    entryLabel: section.entryNoun,
    cardinality: section.cardinality,
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
        <Badge variant="secondary" className="shrink-0 text-[10px]">
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
        <span className="font-mono text-[10px]">{section.key}</span>
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

      {section.kind === 'group' && (
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
            disabled={saving}
            className="h-7 text-xs"
          />
          <p className="mt-[3px] text-[10.5px] text-muted-foreground">
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
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <Label>{t('extraction', 'fieldsCountLabel')}</Label>
      <ReadOnlyValue>{section.totalFieldCount}</ReadOnlyValue>

      <Label>{t('extraction', 'inspectorDescriptionLabel')}</Label>
      <ReadOnlyValue muted={!section.description}>
        {section.description ?? t('extraction', 'inspectorDescriptionEmpty')}
      </ReadOnlyValue>
    </>
  );
}
