import {Fragment, useRef, useState} from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';

import {Input} from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import {
  gridReducer,
  initialGridState,
  recoverFocus,
  type CellCoord,
  type GridRowShape,
} from './gridCellModel';
import type {GridField, GridSection, TemplateMatchHint} from './templateTree';

/**
 * The template configuration grid (spec §2, mock `manager-grid-v3-polish`).
 *
 * B-5 Task 2: an ARIA grid with roving tabIndex — EXACTLY ONE tab stop at
 * all times (defaulting to the first cell), arrows rove between cells via
 * the pure `gridCellModel` reducer, Tab exits (APG), and a grid-level
 * focusin listener keeps the roving coordinate in sync when focus moves by
 * other means (e.g. a Radix menu close refocusing its trigger). The focus
 * ring is painted on the whole <td> from MODEL state via className —
 * `:focus-visible` misses mouse clicks and `:focus-within` drops during
 * portals.
 *
 * Editing is unchanged in this slice of the work: a double-click or the row
 * menu still raises `onEditField`, which the parent bridges to the existing
 * dialog. Tasks 3-5 replace that bridge with inline editors, at which point
 * cells start dispatching real cellKinds ('text'/'ghost') instead of
 * relying on native activation of the cell's inner control.
 */

export interface TemplateGridSelection {
  kind: 'field' | 'section';
  id: string;
}

/**
 * Section-level actions the accordion used to expose through its `⋮` menu.
 * Kept whole so replacing the accordion is not a capability regression;
 * rename stays inline (one commit; since B-4 it stages a draft edit).
 */
export interface TemplateSectionActions {
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onStartRename: (section: GridSection) => void;
  onCommitRename: (sectionId: string) => void;
  onCancelRename: () => void;
  onDelete: (section: GridSection) => void;
  onAddField: (sectionId: string) => void;
}

interface TemplateGridProps {
  sections: GridSection[];
  selection: TemplateGridSelection | null;
  onSelect: (selection: TemplateGridSelection) => void;
  onEditField: (field: GridField) => void;
  onDeleteField: (field: GridField) => void;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
  /** Esc pressed in focus mode: rungs 2-3 of the ladder belong to the
   * panel (close inspector / clear search / deselect). Rung 1 (cancel
   * edit) resolves inside the cell model once editors land. */
  onEscapeEscalate: () => void;
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (sectionId: string) => void;
  showKeyColumn: boolean;
  showOptionsColumn: boolean;
  isFiltering: boolean;
}

type MatchHintCopyKey =
  | 'matchHintKey'
  | 'matchHintDescription'
  | 'matchHintAiInstruction'
  | 'matchHintOptions';

/** The label hit needs no hint — the user can see why it matched. */
const MATCH_HINT_COPY: Record<TemplateMatchHint, MatchHintCopyKey | null> = {
  label: null,
  key: 'matchHintKey',
  description: 'matchHintDescription',
  aiInstruction: 'matchHintAiInstruction',
  options: 'matchHintOptions',
};

/** Indentation ladder from the mock: identity 22px, sub-header 14px, child fields 36px. */
const INDENT = {
  rootField: 'pl-2',
  identityField: 'pl-[22px]',
  childHeader: 'pl-[14px]',
  childField: 'pl-[36px]',
} as const;

// --- Roving-focus plumbing -------------------------------------------------
//
// Every focusable cell target carries `data-cell-row` + `data-cell-cols`
// (the column positions it covers; '*' = whole row, for ghost rows whose
// single cell spans every column). The target is the cell's PRIMARY
// interactive element when it has one (label button, menu trigger,
// collapse chevron) — native Enter/Space activation then works without any
// synthetic events — and the <td> itself when the cell has none yet
// (type/required/AI cells until Tasks 3-5 make them live).

const ADD_SECTION_ROW_ID = 'ghost:template';

const ghostRowId = (sectionId: string) => `ghost:${sectionId}`;

/** Keys the grid routes through the cell model. Everything else (Enter,
 * Space, F2, printables) stays native in this slice: activation happens on
 * the focused inner control itself. */
const ROVING_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Tab',
]);

interface CellFocus {
  /** Resolved roving coordinate — never a dead row (see resolveFocusCoord). */
  coord: CellCoord | null;
  /** Focus is physically inside the grid; the ring only paints then. */
  within: boolean;
}

type CoveredCols = readonly string[] | '*';

function coversColumn(cols: CoveredCols, column: string): boolean {
  return cols === '*' || cols.includes(column);
}

function isCellAt(focus: CellFocus, rowId: string, cols: CoveredCols): boolean {
  return (
    focus.coord !== null &&
    focus.coord.rowId === rowId &&
    coversColumn(cols, focus.coord.column)
  );
}

function rovingTabIndex(focus: CellFocus, rowId: string, cols: CoveredCols): 0 | -1 {
  return isCellAt(focus, rowId, cols) ? 0 : -1;
}

/** Same outline vocabulary as the selected-state ring, painted on the td. */
const CELL_RING = 'outline outline-2 -outline-offset-2 outline-ring';

function ringClass(focus: CellFocus, rowId: string, cols: CoveredCols): string | false {
  return focus.within && isCellAt(focus, rowId, cols) && CELL_RING;
}

function targetCovers(el: HTMLElement, column: string): boolean {
  const cols = el.dataset.cellCols ?? '';
  return cols === '*' || cols.split(' ').includes(column);
}

/** Map a focused/keyed DOM element to a model coordinate, preserving the
 * current column when the target covers it (colSpan cells cover several). */
function coordFromTarget(
  el: HTMLElement,
  current: CellCoord | null,
  columns: readonly string[],
): CellCoord {
  const rowId = el.dataset.cellRow ?? '';
  if (current && targetCovers(el, current.column)) {
    return {rowId, column: current.column};
  }
  const cols = el.dataset.cellCols ?? '';
  return {rowId, column: cols === '*' ? columns[0] : cols.split(' ')[0]};
}

function findFocusTarget(
  table: HTMLTableElement | null,
  coord: CellCoord,
): HTMLElement | null {
  if (!table) return null;
  const candidates = table.querySelectorAll<HTMLElement>(
    `[data-cell-row="${coord.rowId}"]`,
  );
  for (const el of candidates) {
    if (targetCovers(el, coord.column)) return el;
  }
  return null;
}

/** The visible rows in DOM order — the model's vertical axis. Must mirror
 * the JSX exactly (collapse hides fields/children, filtering hides ghosts,
 * child sections have no ghost row until Task 4). */
function buildRowShapes(
  sections: GridSection[],
  collapsed: ReadonlySet<string>,
  isFiltering: boolean,
): GridRowShape[] {
  const rows: GridRowShape[] = [];
  for (const section of sections) {
    rows.push({rowId: section.id, kind: 'section', sectionId: section.id});
    if (collapsed.has(section.id)) continue;
    for (const field of section.fields) {
      rows.push({rowId: field.id, kind: 'field', sectionId: section.id});
    }
    if (!isFiltering) {
      rows.push({rowId: ghostRowId(section.id), kind: 'ghost', sectionId: section.id});
    }
    for (const child of section.children) {
      rows.push({rowId: child.id, kind: 'section', sectionId: child.id});
      if (collapsed.has(child.id)) continue;
      for (const field of child.fields) {
        rows.push({rowId: field.id, kind: 'field', sectionId: child.id});
      }
    }
  }
  if (!isFiltering) {
    rows.push({rowId: ADD_SECTION_ROW_ID, kind: 'ghost', sectionId: ''});
  }
  return rows;
}

/** The invariant lives here: this never returns a coordinate without a
 * live row while the grid has rows, so EXACTLY ONE target renders
 * tabIndex=0 — defaulting to the first cell (the B-1 regression), and
 * recovering to the nearest surviving cell when the focused row unmounts
 * (filter change, delete). */
function resolveFocusCoord(
  focus: CellCoord | null,
  rows: GridRowShape[],
  columns: readonly string[],
): CellCoord | null {
  if (rows.length === 0) return null;
  const fallback: CellCoord = {rowId: rows[0].rowId, column: columns[0]};
  if (!focus) return fallback;
  const column = columns.includes(focus.column) ? focus.column : columns[0];
  if (rows.some((row) => row.rowId === focus.rowId)) {
    return {rowId: focus.rowId, column};
  }
  return recoverFocus({rowId: focus.rowId, column}, null, rows) ?? fallback;
}

function TypePill({field}: {field: GridField}) {
  const label =
    field.optionCount > 0 ? `${field.fieldType} · ${field.optionCount}` : field.fieldType;
  return (
    <span className="inline-block truncate rounded-full border bg-muted/50 px-[7px] py-px text-[10.5px] capitalize text-muted-foreground">
      {label}
    </span>
  );
}

function RequiredBox({checked}: {checked: boolean}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[14px] items-center justify-center rounded border-[1.5px] align-middle',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
      )}
    >
      {checked && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
    </span>
  );
}

function FieldRow({
  field,
  indent,
  selected,
  focus,
  onSelect,
  onEdit,
  onDelete,
  showKeyColumn,
  showOptionsColumn,
}: {
  field: GridField;
  indent: string;
  selected: boolean;
  focus: CellFocus;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  showKeyColumn: boolean;
  showOptionsColumn: boolean;
}) {
  const hintKey = field.matchHint ? MATCH_HINT_COPY[field.matchHint] : null;
  const rowId = field.id;
  return (
    <tr
      data-testid="template-grid-field-row"
      className={cn(
        'group/row h-[30px] border-b border-border/50 hover:bg-muted/40',
        selected && 'bg-muted/60',
      )}
    >
      <td role="gridcell" className="w-3.5 px-2 text-muted-foreground/60">
        <GripVertical className="size-3" aria-hidden />
      </td>
      <td
        role="gridcell"
        className={cn('min-w-0 px-2', indent, ringClass(focus, rowId, ['label']))}
      >
        {/* The roving target is the button, not the td: Enter/Space select
            natively. Double-click (mouse) edits; from the keyboard, select
            then use the inspector's Edit — until Task 3 lands the inline
            editor. */}
        {/* The row itself carries no handlers: a click target that also lives
            on the <tr> fires twice for nested controls, and `stopPropagation`
            on `click` does NOT stop `dblclick` — double-clicking the ⋯ menu
            used to open the edit dialog behind it. */}
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={onEdit}
          aria-current={selected ? 'true' : undefined}
          data-cell-row={rowId}
          data-cell-cols="label"
          tabIndex={rovingTabIndex(focus, rowId, ['label'])}
          className={cn(
            'flex w-full max-w-full items-baseline gap-1.5 rounded text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected && 'outline outline-2 -outline-offset-2 outline-ring',
          )}
        >
          <span className={cn('truncate', field.isRequired && 'font-medium')}>
            {field.label}
          </span>
          {hintKey && (
            <span className="shrink-0 text-[10.5px] text-muted-foreground">
              · {t('extraction', hintKey)}
            </span>
          )}
        </button>
      </td>
      {showKeyColumn && (
        <td
          role="gridcell"
          data-cell-row={rowId}
          data-cell-cols="key"
          tabIndex={rovingTabIndex(focus, rowId, ['key'])}
          className={cn(
            'max-w-[160px] truncate px-2 font-mono text-[10px] text-muted-foreground',
            ringClass(focus, rowId, ['key']),
          )}
        >
          {field.key}
        </td>
      )}
      <td
        role="gridcell"
        data-cell-row={rowId}
        data-cell-cols="type"
        tabIndex={rovingTabIndex(focus, rowId, ['type'])}
        className={cn('w-[110px] px-2', ringClass(focus, rowId, ['type']))}
      >
        <TypePill field={field} />
      </td>
      {showOptionsColumn && (
        <td
          role="gridcell"
          data-cell-row={rowId}
          data-cell-cols="options"
          tabIndex={rovingTabIndex(focus, rowId, ['options'])}
          className={cn(
            'max-w-[200px] truncate px-2 text-[10.5px] text-muted-foreground',
            ringClass(focus, rowId, ['options']),
          )}
        >
          {(field.allowedValues ?? []).join(', ')}
        </td>
      )}
      <td
        role="gridcell"
        data-cell-row={rowId}
        data-cell-cols="required"
        tabIndex={rovingTabIndex(focus, rowId, ['required'])}
        className={cn('w-10 px-2', ringClass(focus, rowId, ['required']))}
      >
        <RequiredBox checked={field.isRequired} />
        <span className="sr-only">
          {t(
            'extraction',
            field.isRequired ? 'inspectorRequiredYes' : 'inspectorRequiredNo',
          )}
        </span>
      </td>
      <td
        role="gridcell"
        data-cell-row={rowId}
        data-cell-cols="sparkle"
        tabIndex={rovingTabIndex(focus, rowId, ['sparkle'])}
        className={cn('w-[26px] px-2', ringClass(focus, rowId, ['sparkle']))}
      >
        {field.hasAiInstruction && (
          <Sparkles className="size-3 text-primary" aria-label={t('extraction', 'gridColAi')} />
        )}
      </td>
      <td
        role="gridcell"
        className={cn('w-[34px] px-1 text-right', ringClass(focus, rowId, ['actions']))}
      >
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('extraction', 'actionsForFieldAria').replace(
                '{{label}}',
                field.label,
              )}
              data-cell-row={rowId}
              data-cell-cols="actions"
              tabIndex={rovingTabIndex(focus, rowId, ['actions'])}
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('extraction', 'gridRowActions')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'gridEditFieldTooltip')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'deleteField')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function SectionHeaderRow({
  section,
  columnCount,
  indent,
  collapsed,
  selected,
  focus,
  spanCols,
  onToggle,
  onSelect,
  actions,
}: {
  section: GridSection;
  columnCount: number;
  indent: string;
  collapsed: boolean;
  selected: boolean;
  focus: CellFocus;
  /** Space-joined middle column positions the header's colSpan cell covers. */
  spanCols: string;
  onToggle: () => void;
  onSelect: () => void;
  actions: TemplateSectionActions;
}) {
  const isRenaming = actions.renamingId === section.id;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const meta = [
    ...section.metaKeys.map((key) => t('extraction', key)),
    String(section.fieldCount),
  ];
  // Two roving stops inside the colSpan cell, in DOM order: the collapse
  // chevron sits at the 'label' position, the section label at the middle
  // positions the colSpan covers — so both stay keyboard-reachable with
  // native Enter activation.
  const spanColList = spanCols.split(' ');
  const cellCols = ['label', ...spanColList];
  return (
    <tr
      data-testid="template-grid-section-row"
      className="h-8 border-b border-border/50 bg-muted/50"
    >
      <td role="gridcell" className="w-3.5 px-2 text-muted-foreground/60">
        <GripVertical className="size-3" aria-hidden />
      </td>
      <td
        role="gridcell"
        colSpan={columnCount - 2}
        className={cn('px-2', indent, ringClass(focus, section.id, cellCols))}
      >
        <div className="flex items-center gap-[7px] overflow-hidden whitespace-nowrap">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={`${t('extraction', collapsed ? 'gridExpandSection' : 'gridCollapseSection')} — ${section.label}`}
            data-cell-row={section.id}
            data-cell-cols="label"
            tabIndex={rovingTabIndex(focus, section.id, ['label'])}
            className="rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Chevron className="size-3.5" aria-hidden />
          </button>
          {isRenaming ? (
            <Input
              value={actions.renameValue}
              autoFocus
              data-cell-row={section.id}
              data-cell-cols={spanCols}
              tabIndex={rovingTabIndex(focus, section.id, spanColList)}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => actions.onRenameValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') actions.onCommitRename(section.id);
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  actions.onCancelRename();
                }
              }}
              onBlur={() => actions.onCommitRename(section.id)}
              className="h-6 max-w-[220px] text-xs"
            />
          ) : (
            <button
              type="button"
              onClick={onSelect}
              aria-current={selected ? 'true' : undefined}
              data-cell-row={section.id}
              data-cell-cols={spanCols}
              tabIndex={rovingTabIndex(focus, section.id, spanColList)}
              className="truncate rounded text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.label}
            </button>
          )}
          {section.hasDescription && (
            <span className="shrink-0 text-primary" aria-hidden>
              ●
            </span>
          )}
          <span className="truncate text-[10.5px] text-muted-foreground">
            · {meta.join(' · ')}
          </span>
        </div>
      </td>
      <td
        role="gridcell"
        className={cn('px-2 text-right', ringClass(focus, section.id, ['actions']))}
      >
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${t('extraction', 'gridAddMenu')} — ${section.label}`}
              data-cell-row={section.id}
              data-cell-cols="actions"
              tabIndex={rovingTabIndex(focus, section.id, ['actions'])}
              className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border bg-card px-[7px] py-px text-[10.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3" aria-hidden />
              <ChevronDown className="size-2.5" aria-hidden />
            </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('extraction', 'gridAddMenu')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem onSelect={() => actions.onAddField(section.id)}>
              <Plus className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'gridNewField')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onStartRename(section)}>
              <Pencil className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'editLabelButton')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => actions.onDelete(section)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'removeButton')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function GhostRow({
  rowId,
  columnCount,
  indent,
  label,
  focus,
  onClick,
  testId,
}: {
  rowId: string;
  columnCount: number;
  indent: string;
  label: string;
  focus: CellFocus;
  onClick: () => void;
  testId: string;
}) {
  return (
    <tr className="h-[30px] border-b border-border/50">
      <td role="gridcell" />
      <td
        role="gridcell"
        colSpan={columnCount - 1}
        className={cn('px-2', indent, ringClass(focus, rowId, '*'))}
      >
        <button
          type="button"
          data-testid={testId}
          data-cell-row={rowId}
          data-cell-cols="*"
          tabIndex={rovingTabIndex(focus, rowId, '*')}
          onClick={onClick}
          className="inline-flex items-center gap-1 rounded italic text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3" aria-hidden />
          {label}
        </button>
      </td>
    </tr>
  );
}

export function TemplateGrid({
  sections,
  selection,
  onSelect,
  onEditField,
  onDeleteField,
  sectionActions,
  onAddSection,
  onEscapeEscalate,
  collapsed,
  onToggleCollapse,
  showKeyColumn,
  showOptionsColumn,
  isFiltering,
}: TemplateGridProps) {
  // grab · label · [key] · type · [options] · required · ai · row actions
  const columnCount = 6 + (showKeyColumn ? 1 : 0) + (showOptionsColumn ? 1 : 0);
  const columns: string[] = [
    'label',
    ...(showKeyColumn ? ['key'] : []),
    'type',
    ...(showOptionsColumn ? ['options'] : []),
    'required',
    'sparkle',
    'actions',
  ];
  const spanCols = columns.filter((c) => c !== 'label' && c !== 'actions').join(' ');
  const rowShapes = buildRowShapes(sections, collapsed, isFiltering);

  const tableRef = useRef<HTMLTableElement>(null);
  // Plain useState (not useReducer) on purpose: handlers run the pure
  // reducer themselves so they can interpret `next.effects` synchronously
  // — imperative .focus() is only ever called inside event handlers, never
  // in effects keyed on the roving coordinate (React Compiler constraint).
  const [gridState, setGridState] = useState(initialGridState);
  const [focusWithin, setFocusWithin] = useState(false);
  const focus: CellFocus = {
    coord: resolveFocusCoord(gridState.focus, rowShapes, columns),
    within: focusWithin,
  };

  const isSelected = (kind: 'field' | 'section', id: string) =>
    selection?.kind === kind && selection.id === id;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    if (event.defaultPrevented) return; // e.g. Radix trigger opened on ArrowDown
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    if (!ROVING_KEYS.has(event.key)) return;
    const holder = target.closest<HTMLElement>('[data-cell-row]');
    if (!holder) return; // portal content (open menus) is not a cell
    const coord = coordFromTarget(holder, gridState.focus, columns);
    let state = gridState;
    if (!state.focus || state.focus.rowId !== coord.rowId || state.focus.column !== coord.column) {
      state = gridReducer(state, {type: 'focusSync', coord});
    }
    const next = gridReducer(state, {
      type: 'key',
      key: event.key,
      cellKind: 'control',
      rows: rowShapes,
      columns,
    });
    for (const effect of next.effects) {
      if (effect.kind === 'escalateEsc') {
        // The central Esc dispatcher: rung 1 (cancelEdit) resolves in the
        // model once Task 3 lands editors; rungs 2-3 are the panel's.
        // stopPropagation keeps the panel's own listener from double-firing.
        event.stopPropagation();
        onEscapeEscalate();
      }
      // 'exitGrid' (Tab): deliberately NOT preventDefault-ed — the grid has
      // one tab stop, so native Tab already leaves it (APG).
      // 'activateControl' / 'commit' / 'cancelEdit': unreachable until the
      // cells dispatch real cellKinds (Tasks 3-5).
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      if (
        next.focus &&
        (next.focus.rowId !== coord.rowId || next.focus.column !== coord.column)
      ) {
        findFocusTarget(tableRef.current, next.focus)?.focus();
      }
    }
    setGridState(next);
  };

  // Grid-level focusin: the roving coordinate follows focus wherever it
  // lands (mouse click on an inner control, Radix menu close refocusing
  // its trigger, the rename input's autoFocus).
  const handleFocusIn = (event: React.FocusEvent<HTMLTableElement>) => {
    setFocusWithin(true);
    const holder = (event.target as HTMLElement).closest<HTMLElement>('[data-cell-row]');
    if (!holder) return;
    const coord = coordFromTarget(holder, gridState.focus, columns);
    const next = gridReducer(gridState, {type: 'focusSync', coord});
    if (next !== gridState) setGridState(next);
  };

  const handleFocusOut = (event: React.FocusEvent<HTMLTableElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setFocusWithin(false);
    }
  };

  // Clicking a cell with no interactive content (type/required/AI) must
  // still focus it — some engines (Safari) never focus a tabindex'd td by
  // themselves. Inner controls keep their native mousedown focus.
  const handleMouseDown = (event: React.MouseEvent<HTMLTableElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [contenteditable="true"]')) return;
    const holder = target.closest<HTMLElement>('[data-cell-row]');
    if (!(holder instanceof HTMLTableCellElement)) return;
    event.preventDefault();
    holder.focus();
  };

  const renderFields = (fields: GridField[], indent: string) =>
    fields.map((field) => (
      <FieldRow
        key={field.id}
        field={field}
        indent={indent}
        selected={isSelected('field', field.id)}
        focus={focus}
        onSelect={() => onSelect({kind: 'field', id: field.id})}
        onEdit={() => onEditField(field)}
        onDelete={() => onDeleteField(field)}
        showKeyColumn={showKeyColumn}
        showOptionsColumn={showOptionsColumn}
      />
    ));

  return (
    <table
      ref={tableRef}
      role="grid"
      aria-label={t('extraction', 'gridAria')}
      className="w-full table-fixed border-collapse text-xs"
      onKeyDown={handleKeyDown}
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
      onMouseDown={handleMouseDown}
    >
      <thead>
        <tr className="h-[26px] border-b border-border/50 text-[9.5px] uppercase tracking-[0.04em] text-muted-foreground">
          <th className="w-3.5" />
          <th className="px-2 text-left font-semibold">{t('extraction', 'gridColLabel')}</th>
          {showKeyColumn && (
            <th className="px-2 text-left font-semibold">{t('extraction', 'gridColKey')}</th>
          )}
          <th className="w-[110px] px-2 text-left font-semibold">
            {t('extraction', 'gridColType')}
          </th>
          {showOptionsColumn && (
            <th className="px-2 text-left font-semibold">
              {t('extraction', 'gridColOptions')}
            </th>
          )}
          <th className="w-10 px-2 text-left font-semibold">
            {t('extraction', 'gridColRequired')}
          </th>
          <th className="w-[26px] px-2" aria-label={t('extraction', 'gridColAi')} />
          <th className="w-[34px]" aria-label={t('extraction', 'gridRowActions')} />
        </tr>
      </thead>

      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.id);
        const isGroup = section.kind === 'group';
        return (
          <tbody
            key={section.id}
            // A repeating group is ONE bounded block: a single accent rule on
            // its left edge, never interior verticals (mock v3 polish).
            className={cn(
              isGroup &&
                '[&>tr>td:first-child]:border-l-2 [&>tr>td:first-child]:border-l-primary',
            )}
          >
            <SectionHeaderRow
              section={section}
              columnCount={columnCount}
              indent="pl-0"
              collapsed={isCollapsed}
              selected={isSelected('section', section.id)}
              focus={focus}
              spanCols={spanCols}
              onToggle={() => onToggleCollapse(section.id)}
              onSelect={() => onSelect({kind: 'section', id: section.id})}
              actions={sectionActions}
            />
            {!isCollapsed && (
              <>
                {renderFields(
                  section.fields,
                  isGroup ? INDENT.identityField : INDENT.rootField,
                )}
                {!isFiltering && (
                  <GhostRow
                    rowId={ghostRowId(section.id)}
                    columnCount={columnCount}
                    indent={isGroup ? INDENT.identityField : INDENT.rootField}
                    label={t('extraction', 'gridNewField')}
                    focus={focus}
                    onClick={() => sectionActions.onAddField(section.id)}
                    testId={`template-grid-add-field-${section.id}`}
                  />
                )}
                {section.children.map((child) => {
                  const childCollapsed = collapsed.has(child.id);
                  return (
                    <Fragment key={child.id}>
                      <SectionHeaderRow
                        section={child}
                        columnCount={columnCount}
                        indent={INDENT.childHeader}
                        collapsed={childCollapsed}
                        selected={isSelected('section', child.id)}
                        focus={focus}
                        spanCols={spanCols}
                        onToggle={() => onToggleCollapse(child.id)}
                        onSelect={() => onSelect({kind: 'section', id: child.id})}
                        actions={sectionActions}
                      />
                      {!childCollapsed && renderFields(child.fields, INDENT.childField)}
                    </Fragment>
                  );
                })}
              </>
            )}
          </tbody>
        );
      })}

      {!isFiltering && (
        <tbody>
          <GhostRow
            rowId={ADD_SECTION_ROW_ID}
            columnCount={columnCount}
            indent="pl-2"
            label={t('extraction', 'gridNewSection')}
            focus={focus}
            onClick={onAddSection}
            testId="template-grid-add-section"
          />
        </tbody>
      )}
    </table>
  );
}
