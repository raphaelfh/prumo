import {useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {Skeleton} from '@/components/ui/skeleton';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {useContainerNarrow} from '@/hooks/shared/useContainerNarrow';
import {t} from '@/lib/copy';
import {validateFieldImpact} from '@/services/extractionFieldService';
import {
  ExtractionFieldSchema,
  type ExtractionField,
  type ExtractionFieldUpdate,
} from '@/types/extraction';

import {
  TemplateGrid,
  type TemplateGridSelection,
  type TemplateSectionActions,
  type TextCellColumn,
} from './TemplateGrid';
import {TemplateConfigToolbar} from './TemplateConfigToolbar';
import {TemplateInspector, type InspectorFocusGroup} from './TemplateInspector';
import {TemplateOutlineRail} from './TemplateOutlineRail';
import {MoveToSectionDialog} from './MoveToSectionDialog';
import {applyRetentionToFilter} from './filterRetention';
import {GridDndContext} from './gridDrag';
import {useMoveFieldTo} from './useMoveFieldTo';
import {useStructuralUndo} from './useStructuralUndo';
import {
  buildTemplateTree,
  collectSectionIds,
  deriveMoveTargets,
  filterTemplateTree,
  findField,
  findSection,
  type GridField,
} from './templateTree';

/**
 * Rail + grid + inspector shell for the Configuration tab (slice B-1).
 *
 * Owns only view state — selection, collapse, search, column display,
 * inspector visibility — plus ALL the inline write paths: label/key
 * commits and every inspector/control-cell save go through the panel's
 * `saveFieldUpdates` routing (B-5 Tasks 3+5) — real rows through the
 * `useUpdateTemplateField` mutation (type changes probed first via
 * `validateFieldImpact`), PENDING optimistic rows through the serialized
 * `useInsertTemplateField` queue (Task 4), whose rows are merged into the
 * tree input here — never written into the shared template-entity-types
 * cache, which the worklist/dashboard read. Since B-4, edits are draft
 * edits — they refresh the grid + Draft chip caches and the explicit
 * Publish button owns versioning.
 *
 * Inspector visibility (Task 5): docked and visible by default at wide
 * container widths; below the 40rem container breakpoint it re-hosts as
 * a Sheet overlay (container queries cannot MOUNT different hosts, so
 * the width is observed — `useContainerNarrow`). `⌘.`/the toolbar button
 * toggle whichever host is active; ✨/Options deep-links open it.
 */

/** Optimistic ghost insert: rendered under `clientKey` until the drain
 * refetch serves the committed row, then pruned (`onDrained`).
 * `overrides` carries inspector/control-cell edits made while the row is
 * still pending, so the optimistic copy tracks the queued writes. */
interface PendingInsert {
  clientKey: string;
  entityTypeId: string;
  name: string;
  label: string;
  sortOrder: number;
  serverId: string | null;
  overrides: ExtractionFieldUpdate;
}

/** 40rem — the container breakpoint below which the docked inspector
 * used to be display-hidden (and its properties uneditable). */
const INSPECTOR_NARROW_PX = 640;

// Re-exported (B-6 T7 extraction) so existing import sites keep working.
export {applyRetentionToFilter};

interface TemplateConfigGridPanelProps {
  projectId: string;
  templateId: string;
  /** Receives the RAW row — the editor-hosted DeleteFieldConfirm needs it. */
  onDeleteField: (field: ExtractionField) => void;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
  /** Bottom `＋▾` menu's "Add repeating group…" (B-8 D8) — the editor
   * opens AddSectionDialog in group mode. */
  onAddGroup: () => void;
}

export function TemplateConfigGridPanel({
  projectId,
  templateId,
  onDeleteField,
  sectionActions,
  onAddSection,
  onAddGroup,
}: TemplateConfigGridPanelProps) {
  // ONE request for the whole structure, TanStack-cached on the key every
  // config mutation invalidates (useTemplateConfigCaches) — so the grid
  // refreshes itself and needs no hand-rolled refresh protocol.
  // `isLoading` is first-load-only, which keeps the rows (and the user's
  // selection, search and collapse state) on screen during a refetch.
  const {entityTypes, isLoading} = useTemplateEntityTypes(templateId);
  // One mutation for the whole panel — NOT per selection: the inspector's
  // save is the PostgREST write (a draft edit; Publish owns versioning).
  const updateField = useUpdateTemplateField(projectId, templateId);
  const [selection, setSelection] = useState<TemplateGridSelection | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  // Rows an inline commit edited AWAY from the active search — kept
  // visible until the query changes (see applyRetentionToFilter).
  const [retained, setRetained] = useState<ReadonlySet<string>>(new Set());
  const [showKeyColumn, setShowKeyColumn] = useState(false);
  const [showOptionsColumn, setShowOptionsColumn] = useState(false);
  // Ghost-row inserts (Task 4): optimistic rows live HERE, merged into
  // the tree input below — never in the shared TanStack cache.
  const [pendingInserts, setPendingInserts] = useState<PendingInsert[]>([]);
  // Client key → server id for confirmed pending rows: the grid's focus
  // coordinate follows the identity when the drain refetch swaps the row.
  const [rowIdRemaps, setRowIdRemaps] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  // Inspector visibility (Task 5): the docked pane defaults open; the
  // narrow-container Sheet is opt-in (an overlay must never auto-cover
  // the grid on mount). ⌘./the toolbar button toggle the ACTIVE host.
  const [dockedOpen, setDockedOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  // ✨/Options deep-link: which inspector group to focus for which field;
  // seq re-triggers the focus on repeated clicks.
  const [focusGroup, setFocusGroup] = useState<
    (InspectorFocusGroup & {fieldId: string}) | null
  >(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNarrow = useContainerNarrow(containerRef, INSPECTOR_NARROW_PX);

  const insertQueue = useInsertTemplateField({
    projectId,
    templateId,
    onConfirmed: (clientKey, field) => {
      setPendingInserts((prev) =>
        prev.map((p) => (p.clientKey === clientKey ? {...p, serverId: field.id} : p)),
      );
      setRowIdRemaps((prev) => {
        const next = new Map(prev);
        next.set(clientKey, field.id);
        return next;
      });
    },
    onFailed: (clientKey) => {
      setPendingInserts((prev) => prev.filter((p) => p.clientKey !== clientKey));
    },
    onDrained: (confirmed) => {
      // The drain invalidation awaited its refetch: confirmed rows are
      // served by the cache now — drop the optimistic copies, and follow
      // the row identity (client key → server id) wherever the panel
      // still points at it. Without the remap the inspector EMPTIES
      // mid-edit and a Save at drain time targets a nonexistent id (the
      // grid's focus coordinate already follows via rowIdRemaps).
      setPendingInserts((prev) => prev.filter((p) => p.serverId === null));
      setSelection((prev) => {
        if (prev?.kind !== 'field') return prev;
        const serverId = confirmed.get(prev.id);
        return serverId ? {kind: 'field', id: serverId} : prev;
      });
      setFocusGroup((prev) => {
        if (!prev) return prev;
        const serverId = confirmed.get(prev.fieldId);
        return serverId ? {...prev, fieldId: serverId} : prev;
      });
    },
  });

  const fetchedFields = useMemo(
    () => entityTypes.flatMap((et) => et.fields),
    [entityTypes],
  );
  // Pending rows merged BEFORE buildTemplateTree (concurrency rule 1).
  // A confirmed row already present in the fetched data is skipped so the
  // drain window never shows a duplicate.
  const mergedFields = useMemo(() => {
    if (pendingInserts.length === 0) return fetchedFields;
    const fetchedIds = new Set(fetchedFields.map((f) => f.id));
    const optimistic = pendingInserts
      .filter((p) => !(p.serverId && fetchedIds.has(p.serverId)))
      .map((p) => ({
        id: p.clientKey,
        entity_type_id: p.entityTypeId,
        description: null,
        field_type: 'text',
        is_required: false,
        allowed_values: null,
        llm_description: null,
        // Queued inspector/control-cell edits on the still-pending row
        // (rule 5) — the identity keys below always win.
        ...p.overrides,
        name: p.name,
        label: p.label,
        sort_order: p.sortOrder,
      }));
    return [...fetchedFields, ...optimistic];
  }, [fetchedFields, pendingInserts]);

  const tree = useMemo(
    () => buildTemplateTree(entityTypes, mergedFields),
    [entityTypes, mergedFields],
  );
  // Rows still client-keyed: the grid disables their row-menu Delete (a
  // queued insert has no cancel API — Task 7) and every move path skips them.
  const pendingRowIds = useMemo(
    () => new Set(pendingInserts.map((p) => p.clientKey)),
    [pendingInserts],
  );
  // B-6 T3: the serialized move/reorder dispatcher — the single chokepoint
  // every structural move (chord, combobox, T6 drag, undo) routes through.
  // Announcements surface via the live region below; `displayTree` carries
  // the optimistic order overlay (decision 7), so the grid renders from it.
  const {moveFieldTo, announcement: moveAnnouncement, displayTree} =
    useMoveFieldTo({projectId, templateId, tree, collapsed, pendingRowIds});
  // B-6 T5: the single-slot Undo wrapper. EVERY chokepoint (the grid's
  // chord + drag via onMoveField, the combobox via moveFieldToSectionEnd)
  // dispatches through it; Undo itself re-enters through the RAW moveFieldTo.
  const {moveFieldWithUndo} = useStructuralUndo({tree, moveFieldTo});
  const filtered = useMemo(
    () => filterTemplateTree(displayTree, query),
    [displayTree, query],
  );
  const visibleSections = useMemo(
    () =>
      filtered.isFiltering
        ? applyRetentionToFilter(displayTree, filtered.sections, retained)
        : filtered.sections,
    [displayTree, filtered.isFiltering, filtered.sections, retained],
  );
  const visibleSectionIds = useMemo(
    () => collectSectionIds(visibleSections),
    [visibleSections],
  );

  const changeQuery = (value: string) => {
    setQuery(value);
    if (retained.size > 0) setRetained(new Set());
  };

  // Selection resolves from displayTree (the decision-7 overlay) so the
  // inspector tracks a mid-flight move instead of snapping back.
  const selectedField =
    selection?.kind === 'field' ? findField(displayTree, selection.id) : null;
  const selectedSection =
    selection?.kind === 'section' ? findSection(displayTree, selection.id) : null;
  const owningSection = selectedField
    ? findSection(displayTree, selectedField.entityTypeId)
    : null;
  // A deep-link only travels with ITS field — selecting another row keeps
  // the inspector from stealing focus to a stale group.
  const inspectorFocusGroup: InspectorFocusGroup | null =
    focusGroup && selectedField && focusGroup.fieldId === selectedField.id
      ? {group: focusGroup.group, seq: focusGroup.seq}
      : null;

  // The grid speaks in projections; the delete confirm needs the raw row.
  const withRawField = (handler: (raw: ExtractionField) => void) => (gridField: GridField) => {
    const raw = entityTypes
      .flatMap((et) => et.fields)
      .find((f) => f.id === gridField.id);
    if (raw) handler(raw);
  };

  /** Rung-2 focus return: the roving contract keeps EXACTLY ONE
   * `tabindex="0"` target inside the grid — that IS the focused cell.
   * The inspector may be unmounting under the focused element, so the
   * focus runs after React's flush (the grid's focusCellSoon pattern;
   * handler-originated, never an effect). */
  const focusGridCellSoon = () => {
    queueMicrotask(() => {
      containerRef.current
        ?.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]')
        ?.focus();
    });
  };

  /**
   * Rungs 2-3 of the Esc ladder — the ONE central dispatcher (Task 6).
   * Rung 1 (cancel a cell or section-rename edit) resolves inside the
   * editors, which stopPropagation so the ladder never advances on the
   * same press. Rung 2: an OPEN inspector (whichever host is active)
   * absorbs the Esc — BEFORE search-clear — and focus returns to the
   * focused cell. Rung 3: clear the search query, else the selection.
   */
  const handleEscapeEscalate = () => {
    if (isNarrow ? sheetOpen : dockedOpen) {
      if (isNarrow) setSheetOpen(false);
      else setDockedOpen(false);
      focusGridCellSoon();
      return;
    }
    if (query) {
      changeQuery('');
      return;
    }
    setSelection(null);
  };

  const isPendingRow = (fieldId: string) =>
    pendingInserts.some((p) => p.clientKey === fieldId);

  // B-6 T4: the inspector combobox's destinations — the CURRENT
  // template's sections only (the client-side move guard), counted from
  // the overlay so a mid-flight END pick lands on the planned order.
  const moveTargets = useMemo(() => deriveMoveTargets(displayTree), [displayTree]);
  /** Combobox pick = END of the destination (filter-independent, so the
   * combobox stays live while the ⌘⇧ chords are filter-gated). Returns
   * the FieldMoveRecord for T5's Undo to capture the inverse. */
  const moveFieldToSectionEnd = (field: GridField, toSectionId: string) =>
    moveFieldWithUndo(
      field,
      toSectionId,
      moveTargets.find((s) => s.id === toSectionId)?.fieldCount ?? 0,
    );
  const movePending = selectedField !== null && pendingRowIds.has(selectedField.id);
  // B-6 T7: the ONE "Move to section…" dialog slot for the whole grid —
  // non-null opens it for that field. Rows request it through the grid's
  // onOpenMoveDialog; ⌘⇧M below is the keyboard entry.
  const [moveDialogField, setMoveDialogField] = useState<GridField | null>(null);
  const closeMoveDialog = () => {
    setMoveDialogField(null);
    focusGridCellSoon();
  };

  // Edit on a STILL-PENDING row: update the optimistic copy and queue the
  // write behind the row's insert by client key (concurrency rule 5).
  const applyPendingUpdate = (clientKey: string, updates: ExtractionFieldUpdate) => {
    setPendingInserts((prev) =>
      prev.map((p) =>
        p.clientKey === clientKey
          ? {
              ...p,
              label: updates.label ?? p.label,
              name: updates.name ?? p.name,
              overrides: {...p.overrides, ...updates},
            }
          : p,
      ),
    );
    insertQueue.enqueueUpdate(clientKey, updates);
  };

  /**
   * ONE write router for every field save — inline text commits, the
   * Required checkbox, the Type menu and the inspector form (Task 5).
   * Pending rows go through the insert queue (no probe: a row that never
   * existed server-side cannot hold extracted data). Real rows go through
   * the update mutation; a TYPE change runs the impact probe first and is
   * refused with the friendly toast when the field already holds data —
   * the same semantics the edit dialog had.
   */
  const saveFieldUpdates = (
    field: GridField,
    updates: ExtractionFieldUpdate,
    onSaved?: () => void,
  ) => {
    if (isPendingRow(field.id)) {
      applyPendingUpdate(field.id, updates);
      // The queue serializes the write; the optimistic copy already moved.
      onSaved?.();
      return;
    }
    const typeChanged =
      typeof updates.field_type === 'string' &&
      updates.field_type !== field.fieldType;
    if (!typeChanged) {
      updateField.mutate(
        {fieldId: field.id, updates},
        onSaved ? {onSuccess: onSaved} : undefined,
      );
      return;
    }
    void (async () => {
      const probe = await validateFieldImpact(
        field.id,
        t('extraction', 'fieldSafeToModifyMessage'),
        (count, articles) =>
          t('extraction', 'fieldExtractedValuesMessage')
            .replace('{{count}}', String(count))
            .replace('{{n}}', String(articles)),
      );
      if (!probe.ok) {
        // The probe itself failed — an honest "could not verify", not
        // the has-extracted-data diagnosis.
        toast.error(t('extraction', 'errors_typeChangeProbeFailed'));
        return;
      }
      if (!probe.data.canChangeType) {
        toast.error(t('extraction', 'errors_cannotChangeFieldType'));
        return;
      }
      updateField.mutate(
        {fieldId: field.id, updates},
        onSaved ? {onSuccess: onSaved} : undefined,
      );
    })();
  };

  /**
   * KEY commits are validated BEFORE the write: `extraction_fields.name`
   * has NO db constraint, and field keys feed the prompt/value mapping —
   * a malformed or duplicate key corrupts it silently. The rules are the
   * insert path's: `ExtractionFieldSchema` name rules (snake_case regex +
   * length caps) plus uniqueness against the section's committed AND
   * pending sibling names. Returns the refusal message, or null when the
   * key is acceptable.
   */
  const validateKeyCommit = (field: GridField, value: string): string | null => {
    const parsed = ExtractionFieldSchema.shape.name.safeParse(value);
    if (!parsed.success) return parsed.error.errors[0].message;
    const siblings = entityTypes.find((et) => et.id === field.entityTypeId)?.fields ?? [];
    const taken = new Set([
      ...siblings.filter((f) => f.id !== field.id).map((f) => f.name),
      ...pendingInserts
        .filter((p) => p.entityTypeId === field.entityTypeId && p.clientKey !== field.id)
        .map((p) => p.name),
    ]);
    if (taken.has(value)) return t('extraction', 'errors_duplicateFieldKey');
    return null;
  };

  // Inline text-cell commits (grid Task 3): label edits update `label`,
  // key-column edits update `name` — validated first; a refusal returns
  // false so the grid keeps the editor open for an in-place fix. The
  // grid already filtered out no-change commits; retention is registered
  // BEFORE the write so the row survives the refetch even if it no
  // longer matches the query.
  const handleCommitField = (
    field: GridField,
    column: TextCellColumn,
    value: string,
  ): boolean => {
    if (column === 'key') {
      const problem = validateKeyCommit(field, value);
      if (problem) {
        toast.error(
          t('extraction', 'errors_validationPrefix').replace('{{message}}', problem),
        );
        return false;
      }
    }
    if (filtered.isFiltering) {
      setRetained((prev) => {
        const next = new Set(prev);
        next.add(field.id);
        return next;
      });
    }
    saveFieldUpdates(field, column === 'label' ? {label: value} : {name: value});
    return true;
  };

  /** Type menu pick (Task 5): dependent groups clear with the NEW type —
   * the dialog's semantics (options/allow-other only survive select
   * kinds, units only numbers). */
  const handleChangeType = (field: GridField, fieldType: string) => {
    if (fieldType === field.fieldType) return;
    const supportsOptions = fieldType === 'select' || fieldType === 'multiselect';
    const updates: ExtractionFieldUpdate = {
      field_type: fieldType as ExtractionFieldUpdate['field_type'],
      ...(supportsOptions
        ? {}
        : {
            allowed_values: null,
            allow_other: false,
            other_label: null,
            other_placeholder: null,
          }),
      ...(fieldType === 'number' ? {} : {unit: null, allowed_units: null}),
    };
    saveFieldUpdates(field, updates);
  };

  /** ✨/Options cells (Task 5): select the field and open the inspector
   * on the right group — the Sheet when the container is narrow. */
  const handleDeepLink = (field: GridField, group: 'ai' | 'options') => {
    setSelection({kind: 'field', id: field.id});
    setFocusGroup((prev) => ({
      fieldId: field.id,
      group,
      seq: (prev?.seq ?? 0) + 1,
    }));
    if (isNarrow) setSheetOpen(true);
    else setDockedOpen(true);
  };

  const toggleInspector = () => {
    if (isNarrow) setSheetOpen((open) => !open);
    else setDockedOpen((open) => !open);
  };

  // Ghost-row commit (Task 4): the queue resolves the collision-suffixed
  // key synchronously so the optimistic row can render at once; sort_order
  // is provisional for display — the DB value is computed at dequeue time.
  const handleInsertField = (sectionId: string, label: string) => {
    const committed = entityTypes.find((et) => et.id === sectionId)?.fields ?? [];
    const baseSortOrder = committed.reduce((max, f) => Math.max(max, f.sort_order), 0);
    const provisionalSortOrder =
      pendingInserts
        .filter((p) => p.entityTypeId === sectionId)
        .reduce((max, p) => Math.max(max, p.sortOrder), baseSortOrder) + 1;
    const {clientKey, name} = insertQueue.enqueueInsert({
      entityTypeId: sectionId,
      label,
      existingNames: committed.map((f) => f.name),
      baseSortOrder,
    });
    setPendingInserts((prev) => [
      ...prev,
      {
        clientKey,
        entityTypeId: sectionId,
        name,
        label,
        sortOrder: provisionalSortOrder,
        serverId: null,
        overrides: {},
      },
    ]);
  };

  if (isLoading) {
    return <Skeleton className="h-72 w-full rounded-md border" />;
  }

  return (
    <div
      className="overflow-hidden rounded-md border bg-card"
      onKeyDown={(event) => {
        if (event.key === 'Escape') handleEscapeEscalate();
        // ⌘. toggles the inspector (Task 5). Panel-scoped on purpose: the
        // shortcut belongs to the Configuration surface, not the page.
        if ((event.metaKey || event.ctrlKey) && event.key === '.') {
          event.preventDefault();
          toggleInspector();
        }
        // ⌘⇧M opens the Move-to-section dialog for the FOCUSED (else the
        // selected) field row; no-ops otherwise (B-6 T7). altKey excluded:
        // ⌥ variants are distinct chords (and ⌥ can mutate event.key).
        // NOTE: Chrome on macOS claims ⌘⇧M for its profile menu, so the
        // binding may lose in the real browser — the ⋯ menu is reliable.
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'm') {
          const holder = (event.target as HTMLElement).closest('[data-cell-row]');
          const focused = findField(displayTree, holder?.getAttribute('data-cell-row') ?? '');
          const field = focused ?? selectedField;
          if (field && !pendingRowIds.has(field.id)) {
            event.preventDefault();
            setMoveDialogField(field);
          }
        }
      }}
    >
      <TemplateConfigToolbar
        query={query}
        onQueryChange={changeQuery}
        matchCount={filtered.isFiltering ? filtered.matchCount : null}
        totalCount={filtered.totalCount}
        showKeyColumn={showKeyColumn}
        onShowKeyColumn={setShowKeyColumn}
        showOptionsColumn={showOptionsColumn}
        onShowOptionsColumn={setShowOptionsColumn}
        inspectorPressed={isNarrow ? sheetOpen : dockedOpen}
        onToggleInspector={toggleInspector}
      />

      {/* B-6 T3: the surface's first live region (precedent SaveSlot) —
          announces completed keyboard moves, since the moved row may
          re-render far away or inside a collapsed section. Always
          mounted so announcements land. */}
      <span role="status" aria-live="polite" className="sr-only">
        {moveAnnouncement}
      </span>

      <div
        ref={containerRef}
        className="@container/grid flex max-h-[70vh] items-stretch"
      >
          <TemplateOutlineRail
            className="hidden @[52rem]/grid:block"
            sections={displayTree}
            visibleSectionIds={visibleSectionIds}
            selectedSectionId={selection?.kind === 'section' ? selection.id : null}
            onSelectSection={(sectionId) => setSelection({kind: 'section', id: sectionId})}
            onAddSection={onAddSection}
            isFiltering={filtered.isFiltering}
          />

        <div className="min-w-0 flex-1 overflow-auto">
          {visibleSections.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {t(
                'extraction',
                filtered.isFiltering ? 'gridNoMatches' : 'gridEmptyTemplate',
              )}
            </p>
          ) : (
            <GridDndContext
              sections={visibleSections}
              collapsed={collapsed}
              isFiltering={filtered.isFiltering}
              pendingRowIds={pendingRowIds}
              onMoveField={moveFieldWithUndo}
            >
              <TemplateGrid
                sections={visibleSections}
                selection={selection}
                onSelect={setSelection}
                onDeleteField={withRawField(onDeleteField)}
                onCommitField={handleCommitField}
                onInsertField={handleInsertField}
                onToggleRequired={(field, isRequired) =>
                  saveFieldUpdates(field, {is_required: isRequired})
                }
                onChangeType={handleChangeType}
                onDeepLink={handleDeepLink}
                onMoveField={moveFieldWithUndo}
                onOpenMoveDialog={setMoveDialogField}
                rowIdRemaps={rowIdRemaps}
                pendingRowIds={pendingRowIds}
                sectionActions={sectionActions}
                onAddSection={onAddSection}
                onAddGroup={onAddGroup}
                // Esc ladder rungs 2-3: the grid escalates here once
                // rung 1 (cancel edit) is resolved in the editors.
                onEscapeEscalate={handleEscapeEscalate}
                collapsed={collapsed}
                onToggleCollapse={(sectionId) => {
                  const next = new Set(collapsed);
                  if (next.has(sectionId)) next.delete(sectionId);
                  else next.add(sectionId);
                  setCollapsed(next);
                }}
                showKeyColumn={showKeyColumn}
                showOptionsColumn={showOptionsColumn}
                isFiltering={filtered.isFiltering}
              />
            </GridDndContext>
          )}
        </div>

        {/* One host at a time: docked pane at wide widths, Sheet overlay
            below the breakpoint — the FORM component is the same, so
            every capability stays editable on narrow containers. */}
        {isNarrow ? (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="right" className="w-[320px] p-0 sm:max-w-[320px]">
              <SheetHeader className="sr-only">
                <SheetTitle>{t('extraction', 'inspectorSheetTitle')}</SheetTitle>
                <SheetDescription>
                  {t('extraction', 'inspectorEmptyHint')}
                </SheetDescription>
              </SheetHeader>
              <TemplateInspector
                className="block h-full w-full border-l-0 pt-10"
                field={selectedField}
                section={selectedSection}
                owningSection={owningSection}
                onSaveField={saveFieldUpdates}
                saving={updateField.isPending}
                sections={moveTargets}
                onMoveField={moveFieldToSectionEnd}
                moveDisabled={movePending}
                focusGroup={inspectorFocusGroup}
              />
            </SheetContent>
          </Sheet>
        ) : (
          dockedOpen && (
            <TemplateInspector
              field={selectedField}
              section={selectedSection}
              owningSection={owningSection}
              onSaveField={saveFieldUpdates}
              saving={updateField.isPending}
              sections={moveTargets}
              onMoveField={moveFieldToSectionEnd}
              moveDisabled={movePending}
              focusGroup={inspectorFocusGroup}
            />
          )
        )}
      </div>

      {/* B-6 T7: ONE dialog for the whole grid (T8's lazy-mount work must
          keep this panel-hosted — never move it into the rows). A pick
          moves to the destination's END via the same moveFieldToSectionEnd
          the combobox uses; closing returns focus to the field's cell. */}
      <MoveToSectionDialog
        field={moveDialogField}
        targets={moveTargets}
        onMove={moveFieldToSectionEnd}
        onClose={closeMoveDialog}
      />
    </div>
  );
}
