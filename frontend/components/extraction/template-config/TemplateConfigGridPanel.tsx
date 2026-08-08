import {useMemo, useRef, useState} from 'react';
import {PanelRight, Search, SlidersHorizontal, X} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {Skeleton} from '@/components/ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {useContainerNarrow} from '@/hooks/shared/useContainerNarrow';
import {t} from '@/lib/copy';
import {validateFieldImpact} from '@/services/extractionFieldService';
import type {ExtractionField, ExtractionFieldUpdate} from '@/types/extraction';

import {
  TemplateGrid,
  type TemplateGridSelection,
  type TemplateSectionActions,
  type TextCellColumn,
} from './TemplateGrid';
import {TemplateInspector, type InspectorFocusGroup} from './TemplateInspector';
import {TemplateOutlineRail} from './TemplateOutlineRail';
import {
  buildTemplateTree,
  collectSectionIds,
  filterTemplateTree,
  findField,
  findSection,
  type GridField,
  type GridSection,
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

/**
 * Keep rows the user just edited AWAY from the active search visible
 * until the query string changes (B-5 Task 3): committing a label that no
 * longer matches must not make the row vanish mid-interaction. Retention
 * is a view concern, so it lives here in the panel's filter application —
 * `templateTree` stays a pure search layer. Retained rows are merged back
 * in ORIGINAL tree order; sections (and child sections) the filter
 * dropped are resurrected when they own a retained field.
 */
export function applyRetentionToFilter(
  tree: GridSection[],
  filteredSections: GridSection[],
  retained: ReadonlySet<string>,
): GridSection[] {
  if (retained.size === 0) return filteredSections;
  const filteredRoots = new Map(filteredSections.map((s) => [s.id, s]));

  const mergeSection = (
    section: GridSection,
    kept: GridSection | undefined,
  ): GridSection | null => {
    const keptFields = new Map((kept?.fields ?? []).map((f) => [f.id, f]));
    const fields = section.fields
      .map((field) => keptFields.get(field.id) ?? (retained.has(field.id) ? field : null))
      .filter((f): f is GridField => f !== null);
    const keptChildren = new Map((kept?.children ?? []).map((c) => [c.id, c]));
    const children = section.children
      .map((child) => mergeSection(child, keptChildren.get(child.id)))
      .filter((child): child is GridSection => child !== null);
    if (!kept && fields.length === 0 && children.length === 0) return null;
    return {...(kept ?? section), fields, children};
  };

  return tree
    .map((section) => mergeSection(section, filteredRoots.get(section.id)))
    .filter((section): section is GridSection => section !== null);
}

interface TemplateConfigGridPanelProps {
  projectId: string;
  templateId: string;
  /** Receives the RAW row — the editor-hosted DeleteFieldConfirm needs it. */
  onDeleteField: (field: ExtractionField) => void;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
}

export function TemplateConfigGridPanel({
  projectId,
  templateId,
  onDeleteField,
  sectionActions,
  onAddSection,
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
    onDrained: () => {
      // The drain invalidation awaited its refetch: confirmed rows are
      // served by the cache now — drop the optimistic copies.
      setPendingInserts((prev) => prev.filter((p) => p.serverId === null));
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
  const filtered = useMemo(() => filterTemplateTree(tree, query), [tree, query]);
  const visibleSections = useMemo(
    () =>
      filtered.isFiltering
        ? applyRetentionToFilter(tree, filtered.sections, retained)
        : filtered.sections,
    [tree, filtered.isFiltering, filtered.sections, retained],
  );
  const visibleSectionIds = useMemo(
    () => collectSectionIds(visibleSections),
    [visibleSections],
  );

  const changeQuery = (value: string) => {
    setQuery(value);
    if (retained.size > 0) setRetained(new Set());
  };

  const selectedField =
    selection?.kind === 'field' ? findField(tree, selection.id) : null;
  const selectedSection =
    selection?.kind === 'section' ? findSection(tree, selection.id) : null;
  const owningSection = selectedField
    ? findSection(tree, selectedField.entityTypeId)
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

  // Rows still client-keyed: the grid disables their row-menu Delete
  // (a queued insert has no cancel API — Task 7).
  const pendingRowIds = useMemo(
    () => new Set(pendingInserts.map((p) => p.clientKey)),
    [pendingInserts],
  );

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
      if (!probe.ok || !probe.data.canChangeType) {
        toast.error(t('extraction', 'errors_cannotChangeFieldType'));
        return;
      }
      updateField.mutate(
        {fieldId: field.id, updates},
        onSaved ? {onSuccess: onSaved} : undefined,
      );
    })();
  };

  // Inline text-cell commits (grid Task 3): label edits update `label`,
  // key-column edits update `name`. The grid already filtered out
  // no-change commits; retention is registered BEFORE the write so the
  // row survives the refetch even if it no longer matches the query.
  const handleCommitField = (
    field: GridField,
    column: TextCellColumn,
    value: string,
  ) => {
    if (filtered.isFiltering) {
      setRetained((prev) => {
        const next = new Set(prev);
        next.add(field.id);
        return next;
      });
    }
    saveFieldUpdates(field, column === 'label' ? {label: value} : {name: value});
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
      }}
    >
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <div className="relative w-[240px]">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder={t('extraction', 'gridSearchPlaceholder')}
            aria-label={t('extraction', 'gridSearchPlaceholder')}
            className="h-8 pl-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => changeQuery('')}
              aria-label={t('extraction', 'gridSearchClear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>

        {filtered.isFiltering && (
          <span className="tabular-nums text-xs text-muted-foreground">
            {t('extraction', 'gridSearchCount')
              .replace('{{n}}', String(filtered.matchCount))
              .replace('{{total}}', String(filtered.totalCount))}
          </span>
        )}

        <span className="flex-1" />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  aria-label={t('extraction', 'gridDisplayMenu')}
                >
                  <SlidersHorizontal className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('extraction', 'gridDisplayMenu')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem
              checked={showKeyColumn}
              onCheckedChange={(checked) => setShowKeyColumn(Boolean(checked))}
            >
              {t('extraction', 'gridDisplayKeyColumn')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showOptionsColumn}
              onCheckedChange={(checked) => setShowOptionsColumn(Boolean(checked))}
            >
              {t('extraction', 'gridDisplayOptionsColumn')}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              aria-label={t('extraction', 'inspectorToggle')}
              aria-pressed={isNarrow ? sheetOpen : dockedOpen}
              onClick={toggleInspector}
            >
              <PanelRight className="size-3.5" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('extraction', 'inspectorToggle')}</TooltipContent>
        </Tooltip>
      </div>

      <div
        ref={containerRef}
        className="@container/grid flex max-h-[70vh] items-stretch"
      >
          <TemplateOutlineRail
            className="hidden @[52rem]/grid:block"
            sections={tree}
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
              rowIdRemaps={rowIdRemaps}
              pendingRowIds={pendingRowIds}
              sectionActions={sectionActions}
              onAddSection={onAddSection}
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
              focusGroup={inspectorFocusGroup}
            />
          )
        )}
      </div>
    </div>
  );
}
