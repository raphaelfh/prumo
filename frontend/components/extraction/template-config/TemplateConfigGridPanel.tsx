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
import {useTemplateEntityTypes} from '@/hooks/extraction/useTemplateEntityTypes';
import {t} from '@/lib/copy';
import type {ExtractionField} from '@/types/extraction';

import {
  TemplateGrid,
  type TemplateGridSelection,
  type TemplateSectionActions,
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
} from './templateTree';

/**
 * Rail + grid + inspector shell for the Configuration tab (slice B-1).
 *
 * Owns only view state — selection, collapse, search, column display. All
 * writes still travel the paths that existed before this slice: the parent
 * keeps its dialogs and its `republish()` call, so the republish cadence
 * per user action is unchanged (see the B-1 plan: inline editing waits for
 * B-4 to stop per-edit republishing).
 */

interface TemplateConfigGridPanelProps {
  templateId: string;
  /** Receives the RAW row, which is what the edit dialog needs. */
  onEditField: (field: ExtractionField) => void;
  onDeleteField: (field: ExtractionField) => void;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
}

export function TemplateConfigGridPanel({
  templateId,
  onEditField,
  onDeleteField,
  sectionActions,
  onAddSection,
}: TemplateConfigGridPanelProps) {
  // ONE request for the whole structure, TanStack-cached on the key
  // `useTemplateRepublish` already invalidates after every config mutation —
  // so the grid refreshes itself and needs no hand-rolled refresh protocol.
  // `isLoading` is first-load-only, which keeps the rows (and the user's
  // selection, search and collapse state) on screen during a refetch.
  const {entityTypes, isLoading} = useTemplateEntityTypes(templateId);
  const [selection, setSelection] = useState<TemplateGridSelection | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [showKeyColumn, setShowKeyColumn] = useState(false);
  const [showOptionsColumn, setShowOptionsColumn] = useState(false);

  const tree = useMemo(
    () => buildTemplateTree(entityTypes, entityTypes.flatMap((et) => et.fields)),
    [entityTypes],
  );
  const filtered = useMemo(() => filterTemplateTree(tree, query), [tree, query]);
  const visibleSectionIds = useMemo(
    () => collectSectionIds(filtered.sections),
    [filtered.sections],
  );

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
      setQuery('');
      return;
    }
    setSelection(null);
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('extraction', 'gridSearchPlaceholder')}
            aria-label={t('extraction', 'gridSearchPlaceholder')}
            className="h-8 pl-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
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
          {filtered.sections.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {t(
                'extraction',
                filtered.isFiltering ? 'gridNoMatches' : 'gridEmptyTemplate',
              )}
            </p>
          ) : (
            <TemplateGrid
              sections={filtered.sections}
              selection={selection}
              onSelect={setSelection}
              onEditField={withRawField(onEditField)}
              onDeleteField={withRawField(onDeleteField)}
              sectionActions={sectionActions}
              onAddSection={onAddSection}
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
        />
      </div>
    </div>
  );
}
