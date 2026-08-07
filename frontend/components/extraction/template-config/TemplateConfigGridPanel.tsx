import {useEffect, useMemo, useState} from 'react';
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
import {toast} from 'sonner';

import {loadEntityTypeFields} from '@/services/extractionFieldService';
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
  filterTemplateTree,
  type GridField,
  type GridSection,
  type TemplateEntityTypeInput,
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
  entityTypes: TemplateEntityTypeInput[];
  /** Bumped by the parent after any mutation, to re-read the fields. */
  refreshToken: number;
  /** Receives the RAW row, which is what the edit dialog needs. */
  onEditField: (field: ExtractionField) => void;
  onDeleteField: (field: ExtractionField) => void;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
}

function collectSectionIds(sections: GridSection[]): Set<string> {
  const ids = new Set<string>();
  for (const section of sections) {
    ids.add(section.id);
    for (const child of section.children) ids.add(child.id);
  }
  return ids;
}

function findField(sections: GridSection[], fieldId: string): GridField | null {
  for (const section of sections) {
    const own = section.fields.find((f) => f.id === fieldId);
    if (own) return own;
    for (const child of section.children) {
      const nested = child.fields.find((f) => f.id === fieldId);
      if (nested) return nested;
    }
  }
  return null;
}

function findSection(sections: GridSection[], sectionId: string): GridSection | null {
  for (const section of sections) {
    if (section.id === sectionId) return section;
    const child = section.children.find((c) => c.id === sectionId);
    if (child) return child;
  }
  return null;
}

export function TemplateConfigGridPanel({
  entityTypes,
  refreshToken,
  onEditField,
  onDeleteField,
  sectionActions,
  onAddSection,
}: TemplateConfigGridPanelProps) {
  const [fields, setFields] = useState<ExtractionField[]>([]);
  // Skeleton only until the first successful load. A refresh (after a
  // dialog save) keeps the current rows on screen instead of flashing —
  // and, more importantly, keeps this component mounted so selection,
  // search and collapse state survive.
  const [fieldsLoaded, setFieldsLoaded] = useState(false);
  const [selection, setSelection] = useState<TemplateGridSelection | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [showKeyColumn, setShowKeyColumn] = useState(false);
  const [showOptionsColumn, setShowOptionsColumn] = useState(false);

  const entityTypeIds = entityTypes.map((et) => et.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = entityTypeIds ? entityTypeIds.split(',') : [];
    // Microtask so the state writes land in an async callback (the pattern
    // TemplateConfigEditor already uses for its own loader).
    queueMicrotask(() => {
      if (cancelled) return;
      if (ids.length === 0) {
        setFields([]);
        setFieldsLoaded(true);
        return;
      }
      // One request per section through the existing service. B-7 replaces
      // this with a single typed endpoint; a batched PostgREST read here
      // would open a new direct data path the fitness gate cannot see.
      void Promise.all(ids.map((id) => loadEntityTypeFields(id))).then((results) => {
        if (cancelled) return;
        const loaded: ExtractionField[] = [];
        let failures = 0;
        for (const result of results) {
          if (result.ok) loaded.push(...result.data);
          else failures += 1;
        }
        // A dropped read would otherwise render the section as legitimately
        // empty — with a `0` count and an inviting "New field" ghost row.
        if (failures > 0) toast.error(t('extraction', 'errors_loadFields'));
        setFields(loaded);
        setFieldsLoaded(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [entityTypeIds, refreshToken]);

  const tree = useMemo(
    () => buildTemplateTree(entityTypes, fields),
    [entityTypes, fields],
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
    const raw = fields.find((f) => f.id === gridField.id);
    if (raw) handler(raw);
  };

  const clearOrDeselect = () => {
    if (query) {
      setQuery('');
      return;
    }
    setSelection(null);
  };

  if (!fieldsLoaded) {
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
        <div className="hidden @[52rem]/grid:contents">
          <TemplateOutlineRail
            sections={tree}
            visibleSectionIds={visibleSectionIds}
            selectedSectionId={selection?.kind === 'section' ? selection.id : null}
            onSelectSection={(sectionId) => setSelection({kind: 'section', id: sectionId})}
            onAddSection={onAddSection}
            isFiltering={filtered.isFiltering}
          />
        </div>

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

        <div className="hidden @[40rem]/grid:contents">
          <TemplateInspector
            field={selectedField}
            section={selectedSection}
            owningSection={owningSection}
            onEditField={withRawField(onEditField)}
          />
        </div>
      </div>
    </div>
  );
}
