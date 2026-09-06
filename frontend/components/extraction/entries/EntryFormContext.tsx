/**
 * The run form's shared plumbing, for a tree that renders itself.
 *
 * `ModelSection` took ~30 props because it was a leaf: one component, one
 * place to thread them from. `EntrySection` recurses, so the same set would
 * have to be re-passed at every level — and every new prop would have to be
 * threaded through every level again.
 *
 * **The Provider must sit ABOVE `ExtractionFormView`'s memo boundary.**
 * Inside it, the memo comparator becomes the gate on the whole context: a
 * bail-out means the provider element is never re-created, the value never
 * changes, and no consumer at any depth updates — the compiler hazard in
 * `.claude/rules/frontend.md`, escalated from "one stale prop" to "the whole
 * form frozen". The precedent is `RunEditabilityProvider`.
 *
 * **Read it where you consume it.** Each `EntrySection` calls
 * `useEntryForm()` itself. Reading once at the root and passing the value
 * down reintroduces exactly the hazard the context is here to avoid.
 *
 * `values` deliberately stops at `EntrySection` and continues to
 * `SectionAccordion` as a PROP: `FieldInput`'s own comparator is what stops
 * per-keystroke work, and it can only do that if the value arrives as a prop.
 */
import {createContext, useContext, type ReactNode} from 'react';

import type {EntryIdentityChanges} from '@/components/extraction/AddEntryDialog';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';

export interface EntryFormContextValue {
  projectId: string;
  articleId: string;
  templateId: string;
  runId?: string;

  /** Every entity type of the template, so a section can find its children. */
  entityTypes: ExtractionEntityTypeWithFields[];
  /** Every instance of the article, from the run view. */
  instances: ExtractionInstance[];

  values: Record<string, ExtractionValue>;
  updateValue: (instanceId: string, fieldId: string, value: ExtractionValue) => void;

  aiSuggestions: Record<string, AISuggestion>;
  acceptSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (instanceId: string, fieldId: string) => Promise<void>;
  selectSuggestion: (
    instanceId: string,
    fieldId: string,
    proposalRecordId: string,
    value: unknown,
    confidence: number,
  ) => Promise<void>;
  getSuggestionsHistory?: (
    instanceId: string,
    fieldId: string,
  ) => Promise<AISuggestionHistoryItem[]>;
  onExtractionComplete?: () => void;
  /** Re-derive the run view after a create/remove/extract. */
  onRefreshInstances: () => Promise<void>;

  /** Scroll-spy + nav rail registration, for sections at any depth. */
  registerSection?: (entityTypeId: string, el: HTMLElement | null) => void;

  /**
   * Open the add-entry dialog. The parent is EXPLICIT: without it the hook
   * falls back to the first instance of the parent type, so adding under the
   * second entry would create under the first.
   */
  onAddEntry: (entityTypeId: string, parentInstanceId: string | null) => void;
  onRemoveInstance: (instanceId: string) => void;
  /** Bulk delete of several entries, through the transactional endpoint.
   * Distinct from `onRemoveInstance`, which is the single browser delete.
   * ABSENT for a non-manager: the endpoint gates on `is_project_manager` to
   * match the RLS policy, so the control is not offered rather than offered
   * and refused. */
  onDeleteEntries?: (instanceIds: string[]) => void;
  onRenameInstance: (instanceId: string, changes: EntryIdentityChanges) => Promise<void>;
  /**
   * Open the rename/re-key dialog for one entry. Distinct from
   * `onRenameInstance`, which APPLIES the change the dialog collected — the
   * selector's pencil has no changes to hand over yet.
   */
  onOpenRenameDialog: (instanceId: string) => void;
  /**
   * Open the remove dialog for one ENTRY. Distinct from
   * `onRemoveInstance`, which is the card list's inline confirm: removing an
   * entry cascades through its whole subtree, so §8 gates it on what that
   * subtree holds rather than on a window.confirm.
   */
  onOpenRemoveDialog: (instanceId: string) => void;

  /**
   * Which entry is active in each rendered group, keyed by
   * `entrySlotKey(article, group, parent)`. Held here, not inside each
   * section, because the nav rail scopes a nested section's progress to the
   * entry the form is showing — and a registry cannot read state that lives
   * inside the sections it is describing.
   */
  activeEntries: Record<string, string>;
  setActiveEntry: (slot: string, entryId: string) => void;

  readOnly?: boolean;
}

const EntryFormContext = createContext<EntryFormContextValue | null>(null);

export function EntryFormProvider(props: {
  value: EntryFormContextValue;
  children: ReactNode;
}): React.ReactElement {
  return (
    <EntryFormContext.Provider value={props.value}>{props.children}</EntryFormContext.Provider>
  );
}

export function useEntryForm(): EntryFormContextValue {
  const ctx = useContext(EntryFormContext);
  if (!ctx) {
    throw new Error('useEntryForm must be used inside an EntryFormProvider');
  }
  return ctx;
}
