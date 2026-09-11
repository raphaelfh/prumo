/**
 * Extraction form view.
 *
 * Renders the form in two regions:
 * 1. ``studyLevelSections`` — top-level accordions, one instance per
 *    article (filled once regardless of the model selection).
 * 2. ``<ModelSection />`` — the model container's selector + container
 *    fields + per-model children, only when the template has a
 *    ``model_container`` (CHARMS does; PROBAST/QUADAS-2 don't).
 *
 * Owns AI extraction wiring (model identification + per-model batch +
 * cross-model batch) but delegates per-section rendering. After the
 * cleanup of migration ``0016_entity_role_column`` the legacy inline
 * conditional that compensated for the missing parent-fields render
 * has moved into ``ModelSection``.
 */

import type {Ref} from 'react';
import {EntrySection} from './entries/EntrySection';
import {EntryFormProvider, type EntryFormContextValue} from './entries/EntryFormContext';
import {SectionAccordion} from './SectionAccordion';
import {SectionNavLayout, type SectionNavHandle} from '@/components/runs/SectionNavLayout';
import {buildSectionRegistry} from '@/lib/extraction/sectionRegistry';
import {useActiveSection} from '@/hooks/extraction/useActiveSection';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import type {EntryIdentityChanges} from './AddEntryDialog';

export interface ExtractionFormViewProps {
  /** Every section of the template. Roots are derived, not passed. */
  entityTypes: ExtractionEntityTypeWithFields[];
  activeEntries: Record<string, string>;
  setActiveEntry: (slot: string, entryId: string) => void;
  handleOpenRenameDialog: (instanceId: string) => void;
  /** Absent for non-managers — see `handleDeleteEntries`. */
  handleOpenRemoveDialog?: (instanceId: string) => void;
  instances: ExtractionInstance[];
  values: Record<string, ExtractionValue>;
  updateValue: (instanceId: string, fieldId: string, value: ExtractionValue) => void;
  aiSuggestions: Record<string, AISuggestion>;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  selectSuggestion: (instanceId: string, fieldId: string, proposalRecordId: string, value: unknown, confidence: number) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  onRefreshInstances: () => Promise<void>;
  handleAddInstance: (entityTypeId: string, parentInstanceId: string | null) => void;
  /** Absent for non-managers — see `handleDeleteEntries`. */
  handleRemoveInstance?: (instanceId: string) => void;
  /** Absent for non-managers: `extraction_instances_delete` is
   * `USING is_project_manager(...)`, so every delete affordance is hidden
   * rather than offered and refused. */
  handleDeleteEntries?: (instanceIds: string[]) => void;
  handleRenameInstance?: (instanceId: string, changes: EntryIdentityChanges) => Promise<void>;
  projectId: string;
  articleId: string;
  /** Required for section-scoped AI extraction. */
  templateId: string;
  /**
   * Active HITL session run id. Passed to AI extraction so proposals
   * accumulate on the session run instead of orphan new runs.
   */
  runId?: string | null;
  /** Callback to refresh values/suggestions after AI extraction. */
  onExtractionComplete?: () => void;
  /** The section layout's handle: the header's suggestion locate opens a section through it. */
  sectionNavRef?: Ref<SectionNavHandle>;
}

// `sectionNavRef` comes out of `props` first: the closures below run during render
// and capture `props`, and the compiler rejects a render-time closure holding a ref.
function ExtractionFormViewComponent({sectionNavRef, ...props}: ExtractionFormViewProps) {

  const roots = props.entityTypes.filter((et) => !et.parent_entity_type_id);
  const sectionRegistry = buildSectionRegistry({
    roots,
    entityTypes: props.entityTypes,
    instances: props.instances,
    values: props.values,
    activeEntries: props.activeEntries,
    articleId: props.articleId,
  });
  const sectionIds = sectionRegistry.map((s) => s.id);
  const { activeId, registerSection, scrollToSection } = useActiveSection(sectionIds);

  const form: EntryFormContextValue = {
    projectId: props.projectId,
    articleId: props.articleId,
    templateId: props.templateId,
    runId: props.runId ?? undefined,
    entityTypes: props.entityTypes,
    instances: props.instances,
    values: props.values,
    updateValue: props.updateValue,
    aiSuggestions: props.aiSuggestions,
    acceptSuggestion: props.acceptSuggestion,
    rejectSuggestion: props.rejectSuggestion,
    selectSuggestion: props.selectSuggestion,
    getSuggestionsHistory: props.getSuggestionsHistory,
    onExtractionComplete: props.onExtractionComplete,
    onRefreshInstances: props.onRefreshInstances,
    registerSection,
    onAddEntry: props.handleAddInstance,
    onRemoveInstance: props.handleRemoveInstance,
    onDeleteEntries: props.handleDeleteEntries,
    onRenameInstance: props.handleRenameInstance ?? (async () => {}),
    onOpenRenameDialog: props.handleOpenRenameDialog,
    onOpenRemoveDialog: props.handleOpenRemoveDialog,
    activeEntries: props.activeEntries,
    setActiveEntry: props.setActiveEntry,
  };

  return (
    <SectionNavLayout ref={sectionNavRef} items={sectionRegistry} activeId={activeId} onSelect={scrollToSection}>
      {/*
        The Provider sits here, and this component is NOT memoized. Inside a
        memo boundary its comparator would gate the whole context: one
        bail-out and no consumer at any depth updates again.
      */}
      <EntryFormProvider value={form}>
        <div className="space-y-4">
          {roots.map((entityType) =>
            entityType.cardinality === 'many' ? (
              <EntrySection key={entityType.id} group={entityType} parentInstanceId={null} />
            ) : (
              <div
                key={entityType.id}
                ref={(el) => registerSection(entityType.id, el)}
                tabIndex={-1}
                className="scroll-mt-4 outline-hidden"
              >
                <SectionAccordion
                  entityType={entityType}
                  instances={props.instances.filter((i) => i.entity_type_id === entityType.id)}
                  fields={entityType.fields}
                  values={props.values}
                  onValueChange={props.updateValue}
                  projectId={props.projectId}
                  articleId={props.articleId}
                  templateId={props.templateId}
                  runId={props.runId ?? undefined}
                  aiSuggestions={props.aiSuggestions}
                  onAcceptAI={props.acceptSuggestion}
                  onRejectAI={props.rejectSuggestion}
                  selectSuggestion={props.selectSuggestion}
                  getSuggestionsHistory={props.getSuggestionsHistory}
                  onAddInstance={() => props.handleAddInstance(entityType.id, null)}
                  onRemoveInstance={props.handleRemoveInstance}
                  onRenameInstance={props.handleRenameInstance}
                  onExtractionComplete={props.onExtractionComplete}
                />
              </div>
            ),
          )}
        </div>
      </EntryFormProvider>
    </SectionNavLayout>
  );
}

/**
 * Exported unmemoized, deliberately.
 *
 * The old `memo` + comparator existed for `models`/`modelsLoading` churn from
 * `useModelManagement`, which no longer exists. It also cannot do its job any
 * more: context consumers re-render through `memo` regardless, so it would
 * only retain the power to block a prop it does not list — and it now hosts
 * the EntryFormProvider, where a bail-out would freeze the entire form.
 */
export const ExtractionFormView = ExtractionFormViewComponent;
