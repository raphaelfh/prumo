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
import type {ExtractionEntityTypeWithFields} from '@/types/extraction';

import {SectionAccordion} from '../SectionAccordion';
import {EntrySelector} from './EntrySelector';
import {useEntryForm} from './EntryFormContext';

export interface EntrySectionProps {
  group: ExtractionEntityTypeWithFields;
  /** The enclosing entry, or null for a root group. */
  parentInstanceId: string | null;
  /** "Identify {noun}s with AI" for this group, when the caller offers it. */
  onIdentifyEntries?: () => void;
  onExtractAllSections?: () => void;
  onExtractAllSectionsForAllEntries?: () => void;
  identifying?: boolean;
  extractingAllSections?: boolean;
  extractingAllSectionsForAllEntries?: boolean;
}

export function EntrySection(props: EntrySectionProps): ReactElement {
  const {group, parentInstanceId} = props;
  // Read the context HERE, not from a parent. A value threaded down from a
  // memoized ancestor stops updating without any build or type error — the
  // silent hazard in `.claude/rules/frontend.md` § React Compiler.
  const form = useEntryForm();

  const {entries, entryCards, activeEntryId, setActiveEntryId, noun} = useEntryGroup({
    articleId: form.articleId,
    group,
    parentInstanceId,
    instances: form.instances,
    values: form.values,
    entityTypes: form.entityTypes,
  });

  const children = form.entityTypes.filter((et) => et.parent_entity_type_id === group.id);

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
        onRemoveEntry={form.onRemoveInstance}
        onRenameEntry={form.onRenameInstance}
        onIdentifyEntries={props.onIdentifyEntries}
        onExtractAllSections={activeEntryId ? props.onExtractAllSections : undefined}
        onExtractAllSectionsForAllEntries={props.onExtractAllSectionsForAllEntries}
        identifying={props.identifying}
        extractingAllSections={props.extractingAllSections}
        extractingAllSectionsForAllEntries={props.extractingAllSectionsForAllEntries}
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
