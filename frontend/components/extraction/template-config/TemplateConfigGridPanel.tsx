import {useMemo, useState} from 'react';
import {Search, SlidersHorizontal, X} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useInsertTemplateField} from '@/hooks/extraction/useInsertTemplateField';
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {useUpdateTemplateField} from '@/hooks/extraction/useUpdateTemplateField';
import {t} from '@/lib/copy';
import type {ExtractionField} from '@/types/extraction';

import {
  TemplateGrid,
  type TemplateGridSelection,
  type TemplateSectionActions,
  type TextCellColumn,
} from './TemplateGrid';
import {TemplateInspector} from './TemplateInspector';
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
 * Owns only view state — selection, collapse, search, column display —
 * plus the inline write paths: label/key commits go through the panel's
 * `useUpdateTemplateField` mutation (B-5 Task 3), and ghost-row inserts
 * through the serialized `useInsertTemplateField` queue (Task 4) with
 * PANEL-LOCAL optimistic rows: pending inserts are merged into the tree
 * input here — never written into the shared template-entity-types cache,
 * which the worklist/dashboard read. Other field properties still travel
 * the pre-B-5 dialog paths. Since B-4, edits are draft edits — they
 * refresh the grid + Draft chip caches and the explicit Publish button
 * owns versioning.
 */

/** Optimistic ghost insert: rendered under `clientKey` until the drain
 * refetch serves the committed row, then pruned (`onDrained`). */
interface PendingInsert {
  clientKey: string;
  entityTypeId: string;
  name: string;
  label: string;
  sortOrder: number;
  serverId: string | null;
}

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
  /** Receives the RAW row, which is what the edit dialog needs. */
  onEditField: (field: ExtractionField) => void;
  onDeleteField: (field: ExtractionField) => void;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
}

export function TemplateConfigGridPanel({
  projectId,
  templateId,
  onEditField,
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
        name: p.name,
        label: p.label,
        description: null,
        field_type: 'text',
        is_required: false,
        allowed_values: null,
        llm_description: null,
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

  // The grid speaks in projections; the dialogs need the row they came from.
  const withRawField = (handler: (raw: ExtractionField) => void) => (gridField: GridField) => {
    const raw = entityTypes
      .flatMap((et) => et.fields)
      .find((f) => f.id === gridField.id);
    if (raw) handler(raw);
  };

  const clearOrDeselect = () => {
    if (query) {
      changeQuery('');
      return;
    }
    setSelection(null);
  };

  // Inline text-cell commits (grid Task 3): label edits update `label`,
  // key-column edits update `name`. The grid already filtered out
  // no-change commits; retention is registered BEFORE the write so the
  // row survives the refetch even if it no longer matches the query.
  // An edit on a STILL-PENDING row updates the optimistic copy and queues
  // behind its insert by client key (concurrency rule 5).
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
    const updates = column === 'label' ? {label: value} : {name: value};
    if (pendingInserts.some((p) => p.clientKey === field.id)) {
      setPendingInserts((prev) =>
        prev.map((p) => (p.clientKey === field.id ? {...p, ...updates} : p)),
      );
      insertQueue.enqueueUpdate(field.id, updates);
      return;
    }
    updateField.mutate({fieldId: field.id, updates});
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
        if (event.key === 'Escape') clearOrDeselect();
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
      </div>

      <div className="@container/grid flex max-h-[70vh] items-stretch">
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
              onEditField={withRawField(onEditField)}
              onDeleteField={withRawField(onDeleteField)}
              onCommitField={handleCommitField}
              onInsertField={handleInsertField}
              rowIdRemaps={rowIdRemaps}
              sectionActions={sectionActions}
              onAddSection={onAddSection}
              // Esc ladder rungs 2-3: the grid's central dispatcher
              // escalates here once rung 1 (cancel edit) is resolved.
              onEscapeEscalate={clearOrDeselect}
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

        <TemplateInspector
          className="hidden @[40rem]/grid:block"
          field={selectedField}
          section={selectedSection}
          owningSection={owningSection}
          onEditField={withRawField(onEditField)}
          updateField={updateField}
        />
      </div>
    </div>
  );
}
