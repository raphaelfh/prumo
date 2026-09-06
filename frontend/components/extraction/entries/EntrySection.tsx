/**
 * One entry group of the run form — and, through itself, everything under it.
 *
 * Replaces `ModelSection`, which could only ever render the one
 * `model_container` the `role` column allowed. Structure comes from the tree:
 * a group that OWNS children renders a selector of its entries plus its
 * children bound to the active entry; a group without children renders the
 * instance-card list (spec §8).
 *
 * Both branches are reachable on CHARMS today, at different depths:
 * `prediction_models` owns children and takes the selector branch, and it
 * recurses into `final_predictors`, which owns none and takes the card
 * branch. What is NOT reachable until migration 0069 is a nested group that
 * itself owns children — 0016's trigger requires a `model_section`'s parent
 * be the container — so no fixture here pretends otherwise.
 */
import type {ReactElement} from 'react';

import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';
import {useEntryGroup} from '@/hooks/extraction/useEntryGroup';
import {useExtractionFormAIActions} from '@/hooks/extraction/useExtractionFormAIActions';
import type {ExtractionEntityTypeWithFields} from '@/types/extraction';

import {SectionAccordion} from '../SectionAccordion';
import {EntrySelector} from './EntrySelector';
import {useEntryForm} from './EntryFormContext';

export interface EntrySectionProps {
  group: ExtractionEntityTypeWithFields;
  /** The enclosing entry, or null for a root group. */
  parentInstanceId: string | null;
}

export function EntrySection(props: EntrySectionProps): ReactElement {
  const {group, parentInstanceId} = props;
  // Read the context HERE, not from a parent. A value threaded down from a
  // memoized ancestor stops updating without any build or type error — the
  // silent hazard in `.claude/rules/frontend.md` § React Compiler.
  const form = useEntryForm();

  const {entries, entryCards, activeEntryId, setActiveEntryId} = useEntryGroup({
    articleId: form.articleId,
    group,
    parentInstanceId,
    instances: form.instances,
    values: form.values,
    entityTypes: form.entityTypes,
    activeEntries: form.activeEntries,
    setActiveEntry: form.setActiveEntry,
  });

  const children = form.entityTypes.filter((et) => et.parent_entity_type_id === group.id);

  // Per-group AI actions. §8 puts "Identify {noun}s with AI" and "Extract all
  // sections for this/every {noun}" on EVERY group's selector, so the hook
  // instantiates per section rather than once at the form — and now carries
  // the coordinate that makes that true: identification targets THIS group
  // under THIS parent entry, not the one container the retired endpoint
  // could name.
  const ai = useExtractionFormAIActions({
    projectId: form.projectId,
    articleId: form.articleId,
    templateId: form.templateId,
    entityTypeId: group.id,
    parentInstanceId,
    runId: form.runId,
    sections: children,
    activeModelId: activeEntryId,
    models: entryCards,
    onRefreshInstances: form.onRefreshInstances,
    onExtractionComplete: form.onExtractionComplete,
  });

  const accordionPlumbing = {
    values: form.values,
    onValueChange: form.updateValue,
    projectId: form.projectId,
    articleId: form.articleId,
    templateId: form.templateId,
    runId: form.runId,
    aiSuggestions: form.aiSuggestions,
    onAcceptAI: form.acceptSuggestion,
    onRejectAI: form.rejectSuggestion,
    selectSuggestion: form.selectSuggestion,
    getSuggestionsHistory: form.getSuggestionsHistory,
    onExtractionComplete: form.onExtractionComplete,
  };

  // A group with no children of its own is a plain repeating section: the
  // card list manages its entries directly, with no selector and no
  // per-entry region to scope anything to.
  if (children.length === 0) {
    return (
      <div
        ref={(el) => form.registerSection?.(group.id, el)}
        tabIndex={-1}
        className="scroll-mt-4 outline-hidden"
      >
        <SectionAccordion
          entityType={group}
          instances={entries}
          fields={group.fields}
          parentInstanceId={parentInstanceId ?? undefined}
          onAddInstance={() => form.onAddEntry(group.id, parentInstanceId)}
          onRemoveInstance={form.onRemoveInstance}
          onRenameInstance={form.onRenameInstance}
          {...accordionPlumbing}
        />
      </div>
    );
  }

  const activeEntry = entries.filter((e) => e.id === activeEntryId);

  return (
    <div
      ref={(el) => form.registerSection?.(group.id, el)}
      tabIndex={-1}
      className="scroll-mt-4 outline-hidden"
    >
      <EntrySelector
        entryLabel={group.entry_label ?? DEFAULT_ENTRY_NOUN}
        title={group.label}
        entries={entryCards}
        activeEntryId={activeEntryId}
        onSelectEntry={setActiveEntryId}
        onAddEntry={() => form.onAddEntry(group.id, parentInstanceId)}
        onRemoveEntry={form.onOpenRemoveDialog}
        onDeleteEntries={form.onDeleteEntries}
        onRenameEntry={form.onOpenRenameDialog}
        onIdentifyEntries={ai.handleIdentifyEntries}
        onExtractAllSections={activeEntryId ? ai.handleExtractAllSections : undefined}
        onExtractAllSectionsForAllEntries={ai.handleExtractAllSectionsForAllModels}
        identifying={ai.identifying}
        extractingAllSections={ai.extractingAllSections}
        extractingAllSectionsForAllEntries={ai.extractingAllSectionsForAllModels}
        readOnly={form.readOnly}
      />

      {activeEntryId && (
        <div className="space-y-4 mt-4">
          {/*
            The group is itself a section with fields (CHARMS ships
            `model_name`; a manager can add more), so they bind to the
            active entry. No add/remove handlers here: the selector above is
            the single management surface for this group's entries — its
            dialogs create the singleton children and gate removal on the
            whole subtree, which the generic buttons bypassed.
          */}
          {group.fields.length > 0 && (
            <SectionAccordion
              key={group.id}
              entityType={group}
              instances={activeEntry}
              totalInstanceCount={entries.length}
              fields={group.fields}
              {...accordionPlumbing}
            />
          )}

          {children.map((child) =>
            child.cardinality === 'many' ? (
              // Recursion: the nested group's parent is THIS group's active
              // entry, so switching entries switches the whole subtree.
              <EntrySection key={child.id} group={child} parentInstanceId={activeEntryId} />
            ) : (
              <div
                key={child.id}
                ref={(el) => form.registerSection?.(child.id, el)}
                tabIndex={-1}
                className="scroll-mt-4 outline-hidden"
              >
                <SectionAccordion
                  entityType={child}
                  instances={form.instances.filter(
                    (i) =>
                      i.entity_type_id === child.id && i.parent_instance_id === activeEntryId,
                  )}
                  fields={child.fields}
                  parentInstanceId={activeEntryId}
                  onAddInstance={() => form.onAddEntry(child.id, activeEntryId)}
                  onRemoveInstance={form.onRemoveInstance}
                  onRenameInstance={form.onRenameInstance}
                  {...accordionPlumbing}
                />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
