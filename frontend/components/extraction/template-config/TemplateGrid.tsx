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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  type CellKind,
  type GridRowShape,
} from './gridCellModel';
import {
  FIELD_TYPE_OPTIONS,
  findField,
  type GridField,
  type GridSection,
  type TemplateMatchHint,
} from './templateTree';

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
 * B-5 Task 3: TEXT cells (Label; Key when shown) edit inline per the
 * Airtable contract — second-click/Enter/F2 open the editor on the current
 * value (selected), typing opens it seeded with the typed key (typing
 * replaces), Enter commits and advances DOWN, blur commits in place, Esc
 * reverts with focus staying on the cell. Commits surface through
 * `onCommitField`; the row menu still raises `onEditField` for the
 * dialog's other properties (absorbed by the inspector in Task 5).
 *
 * B-5 Task 4: GHOST rows (every section, child sections included) edit
 * inline — click/Enter/typing opens the ghost editor, Enter commits the
 * drafted field through `onInsertField` and REOPENS the same editor (the
 * Enter-chain), Enter on an empty draft exits, a never-typed ghost
 * auto-discards on blur, a typed one commits. The `＋ ▾` New-field item
 * focuses the section's ghost editor instead of the old add dialog. The
 * panel owns the optimistic pending rows; `rowIdRemaps` keeps the focus
 * coordinate alive when a confirmed pending row swaps its client key for
 * the server id.
 *
 * B-5 Task 5: CONTROL cells act on the FIRST click. The Type cell is a
 * menu trigger (the pick routes through `onChangeType`, probed by the
 * panel), Required is a real checkbox (`onToggleRequired` — the panel
 * routes real rows vs pending rows; the grid stays write-free), and the
 * ✨/Options cells deep-link the inspector to the right group
 * (`onDeepLink`). Mouse/Space activation is native on each control;
 * keyboard Enter/F2 routes through the cell model and the effects loop
 * interprets `activateControl` — a native checkbox ignores Enter, and
 * preventDefault keeps button cells from double-firing.
 *
 * B-5 Task 6: the section RENAME is row-local — SectionHeaderRow owns
 * rename mode, the mounted editor owns the draft, and both exits leave
 * rename mode synchronously so the editor unmounts while focused (no
 * blur-commit can follow an Enter commit or an Esc cancel — the Task-3
 * exactly-once pattern). The parent receives ONE commit per rename;
 * Esc cancels locally (ladder rung 1) with focus staying on the cell.
 */

export interface TemplateGridSelection {
  kind: 'field' | 'section';
  id: string;
}

/**
 * Section-level actions the accordion used to expose through its `⋮` menu.
 * Kept whole so replacing the accordion is not a capability regression.
 * Since Task 6 the ROW owns rename mode and its draft (SectionHeaderRow);
 * the parent owns only the write — ONE commit per rename, called with a
 * CHANGED, non-empty, trimmed label (a revert never reaches it).
 */
export interface TemplateSectionActions {
  onCommitRename: (sectionId: string, label: string) => void;
  onDelete: (section: GridSection) => void;
  /** Unused since Task 4 — the ghost editor owns "New field" (both the
   * ghost rows and the `＋ ▾` item). Deleted with the dialogs in Task 8. */
  onAddField: (sectionId: string) => void;
}

/** Columns that edit inline as free text. */
export type TextCellColumn = 'label' | 'key';

interface TemplateGridProps {
  sections: GridSection[];
  selection: TemplateGridSelection | null;
  onSelect: (selection: TemplateGridSelection) => void;
  onEditField: (field: GridField) => void;
  onDeleteField: (field: GridField) => void;
  /** Inline text-cell commit — label/key writes belong to the panel. Only
   * called with a CHANGED, non-empty, trimmed value. */
  onCommitField: (field: GridField, column: TextCellColumn, value: string) => void;
  /** Ghost-row commit (Task 4): the panel owns the optimistic insert
   * queue. Only called with a non-empty, trimmed label. */
  onInsertField: (sectionId: string, label: string) => void;
  /** Required-cell toggle (Task 5): the panel routes the write (update
   * mutation for real rows, insert queue for pending rows). */
  onToggleRequired: (field: GridField, isRequired: boolean) => void;
  /** Type-menu pick (Task 5): the panel runs the impact probe and the
   * type-dependent clears before writing. */
  onChangeType: (field: GridField, fieldType: string) => void;
  /** ✨/Options cell activation (Task 5): the panel selects the field and
   * opens the inspector on the group (docked or Sheet). */
  onDeepLink: (field: GridField, group: 'ai' | 'options') => void;
  /** Client key → server id for pending rows the panel reconciled: the
   * focus coordinate follows the row identity across the drain refetch. */
  rowIdRemaps?: ReadonlyMap<string, string>;
  /** Rows still living under a client key (Task 7). Their queued insert
   * has no cancel API, so the row menu's Delete DISABLES until the drain
   * swaps the row to its server id — the simpler of the two options
   * (deleting a field right after creating it is rare enough not to buy
   * a queue-cancel path). */
  pendingRowIds?: ReadonlySet<string>;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
  /** Esc pressed in focus mode: rungs 2-3 of the ladder belong to the
   * panel's central dispatcher (close inspector with focus-return, then
   * clear search / deselect). Rung 1 (cancel a cell or rename edit)
   * resolves inside the editors, which stopPropagation. */
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

/** Keys the grid routes through the cell model on EVERY cell. Text and
 * ghost cells additionally route Enter/F2/printables (they open the
 * inline editor); on control cells those stay native — activation
 * happens on the focused inner control itself. */
const ROVING_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Tab',
]);

/** Which cells edit as free text: the label/key columns of FIELD rows,
 * plus every FIELD ghost row ('ghost' — Task 4's Enter-chain). The
 * template-level add-section ghost (empty sectionId) keeps native button
 * activation until sections go inline (B-8); section rows keep native
 * activation (rename ownership is Task 6). */
function cellKindAt(coord: CellCoord, rows: GridRowShape[]): CellKind {
  const row = rows.find((r) => r.rowId === coord.rowId);
  if (!row) return 'control';
  if (row.kind === 'ghost') return row.sectionId === '' ? 'control' : 'ghost';
  if (row.kind !== 'field') return 'control';
  return coord.column === 'label' || coord.column === 'key' ? 'text' : 'control';
}

/** Field-row control cells whose keyboard activation the GRID interprets
 * (via the model's `activateControl` effect): the required checkbox
 * ignores a native Enter, and the ✨/Options buttons must not double-fire
 * (interpretation preventDefaults the native Enter-click). The type and
 * actions cells stay fully native — their Radix triggers own Enter. */
const INTERPRETED_CONTROL_COLUMNS = new Set(['required', 'sparkle', 'options']);

function interpretsActivation(coord: CellCoord, rows: GridRowShape[]): boolean {
  const row = rows.find((r) => r.rowId === coord.rowId);
  return row?.kind === 'field' && INTERPRETED_CONTROL_COLUMNS.has(coord.column);
}

/** A key that types a character. Ctrl/Cmd chords are commands, never
 * seeds; Option-composed characters (pt-BR accents via dead keys are the
 * `isComposing`/'Dead' branch) still count. */
function isPrintableKey(event: React.KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey;
}

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
 * the JSX exactly (collapse hides fields/children, filtering hides
 * ghosts; every section — child sections included — carries a ghost). */
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
      if (!isFiltering) {
        rows.push({rowId: ghostRowId(child.id), kind: 'ghost', sectionId: child.id});
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
  rowIdRemaps: ReadonlyMap<string, string> | undefined,
): CellCoord | null {
  if (rows.length === 0) return null;
  const fallback: CellCoord = {rowId: rows[0].rowId, column: columns[0]};
  if (!focus) return fallback;
  const column = columns.includes(focus.column) ? focus.column : columns[0];
  if (rows.some((row) => row.rowId === focus.rowId)) {
    return {rowId: focus.rowId, column};
  }
  // Rule 5 (focus remap): a confirmed pending row now renders under its
  // server id — follow the row's identity instead of "recovering".
  const remapped = rowIdRemaps?.get(focus.rowId);
  if (remapped && rows.some((row) => row.rowId === remapped)) {
    return {rowId: remapped, column};
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

/**
 * Inline editor for a text cell — the compiler-safe recipe (plan Global
 * Constraints): `autoFocus` + `onFocus` select() for focus-then-edit, the
 * draft seeded from the typed key for typing-replaces, zero refs/effects
 * for focus. Mounted only while the model is in edit mode on this cell,
 * so `useState` re-seeds per edit session. Height-capped like the h-6
 * rename input to preserve the 30px rows.
 */
function TextCellEditor({
  initialValue,
  selectOnFocus,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  selectOnFocus: boolean;
  ariaLabel: string;
  onCommit: (draft: string, via: 'enter' | 'blur') => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  return (
    <Input
      value={draft}
      autoFocus
      aria-label={ariaLabel}
      onFocus={(event) => {
        if (selectOnFocus) event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onCommit(draft, 'enter');
        }
        if (event.key === 'Escape') {
          // Rung 1 belongs to the editor: without stopPropagation the
          // panel's Esc listener would also clear the search/selection.
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onBlur={() => onCommit(draft, 'blur')}
      className="h-6 text-xs"
    />
  );
}

/**
 * Inline rename editor for a section header (Task 6) — the same
 * compiler-safe recipe as TextCellEditor (mount-scoped draft,
 * `autoFocus`, zero refs/effects), kept separate because the rename
 * target is a colSpan cell: it stays in the roving order under the
 * section row's span columns. The row decides what a commit/cancel
 * means; the editor only reports them.
 */
function SectionRenameEditor({
  initialValue,
  rowId,
  spanCols,
  tabIndex,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  rowId: string;
  spanCols: string;
  tabIndex: 0 | -1;
  onCommit: (draft: string, via: 'enter' | 'blur') => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  return (
    <Input
      value={draft}
      autoFocus
      aria-label={t('extraction', 'gridRenameSectionAria')}
      data-cell-row={rowId}
      data-cell-cols={spanCols}
      tabIndex={tabIndex}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onCommit(draft, 'enter');
        }
        if (event.key === 'Escape') {
          // Rung 1 belongs to the editor (see TextCellEditor).
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onBlur={() => onCommit(draft, 'blur')}
      className="h-6 max-w-[220px] text-xs"
    />
  );
}

function FieldRow({
  field,
  indent,
  selected,
  focus,
  editing,
  onSelect,
  onEdit,
  onDelete,
  deleteDisabled,
  onEditorCommit,
  onEditorCancel,
  onToggleRequired,
  onChangeType,
  onDeepLink,
  showKeyColumn,
  showOptionsColumn,
}: {
  field: GridField;
  indent: string;
  selected: boolean;
  focus: CellFocus;
  /** Non-null while the model is in edit mode on one of this row's text
   * cells; `seed` carries the typed key for typing-replaces. */
  editing: {column: TextCellColumn; seed: string | null} | null;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** True on pending optimistic rows — see `pendingRowIds`. */
  deleteDisabled: boolean;
  onEditorCommit: (column: TextCellColumn, draft: string, via: 'enter' | 'blur') => void;
  onEditorCancel: () => void;
  onToggleRequired: (isRequired: boolean) => void;
  onChangeType: (fieldType: string) => void;
  onDeepLink: (group: 'ai' | 'options') => void;
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
            natively; a second click / Enter / F2 / typing swaps it for the
            inline editor (the model's text-cell transitions). */}
        {/* The row itself carries no handlers: a click target that also lives
            on the <tr> fires twice for nested controls, and `stopPropagation`
            on `click` does NOT stop `dblclick` — double-clicking the ⋯ menu
            used to open the edit dialog behind it. */}
        {editing?.column === 'label' ? (
          <TextCellEditor
            initialValue={editing.seed ?? field.label}
            selectOnFocus={editing.seed === null}
            ariaLabel={t('extraction', 'gridEditLabelAria')}
            onCommit={(draft, via) => onEditorCommit('label', draft, via)}
            onCancel={onEditorCancel}
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
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
        )}
      </td>
      {showKeyColumn && (
        <td
          role="gridcell"
          data-cell-row={rowId}
          data-cell-cols="key"
          // While the editor (an implicit tab stop) is inside, the td
          // steps out of the roving order — one tab stop at all times.
          tabIndex={
            editing?.column === 'key' ? -1 : rovingTabIndex(focus, rowId, ['key'])
          }
          className={cn(
            'max-w-[160px] truncate px-2 font-mono text-[10px] text-muted-foreground',
            ringClass(focus, rowId, ['key']),
          )}
        >
          {editing?.column === 'key' ? (
            <TextCellEditor
              initialValue={editing.seed ?? field.key}
              selectOnFocus={editing.seed === null}
              ariaLabel={t('extraction', 'gridEditKeyAria')}
              onCommit={(draft, via) => onEditorCommit('key', draft, via)}
              onCancel={onEditorCancel}
            />
          ) : (
            field.key
          )}
        </td>
      )}
      <td
        role="gridcell"
        className={cn('w-[110px] px-2', ringClass(focus, rowId, ['type']))}
      >
        {/* Control cells act on the FIRST click (Task 5): the pill is the
            menu trigger, so click/Enter/Space open natively and a pick
            routes to the panel's probed write. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('extraction', 'gridTypeMenuAria').replace(
                '{{label}}',
                field.label,
              )}
              data-cell-row={rowId}
              data-cell-cols="type"
              tabIndex={rovingTabIndex(focus, rowId, ['type'])}
              className="block max-w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TypePill field={field} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="text-xs">
            <DropdownMenuRadioGroup
              value={field.fieldType}
              onValueChange={(value) => {
                if (value !== field.fieldType) onChangeType(value);
              }}
            >
              {FIELD_TYPE_OPTIONS.map(({value, copyKey}) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {t('extraction', copyKey)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
      {showOptionsColumn && (
        <td
          role="gridcell"
          className={cn(
            'max-w-[200px] px-2',
            ringClass(focus, rowId, ['options']),
          )}
        >
          <button
            type="button"
            onClick={() => onDeepLink('options')}
            aria-label={t('extraction', 'gridOptionsCellAria').replace(
              '{{label}}',
              field.label,
            )}
            data-cell-row={rowId}
            data-cell-cols="options"
            tabIndex={rovingTabIndex(focus, rowId, ['options'])}
            className="block min-h-[18px] w-full truncate rounded text-left text-[10.5px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(field.allowedValues ?? []).join(', ')}
          </button>
        </td>
      )}
      <td
        role="gridcell"
        className={cn('w-10 px-2', ringClass(focus, rowId, ['required']))}
      >
        {/* A REAL checkbox toggling on the first click; sr-only input +
            the 14px visual keep the compact look. Space toggles natively;
            Enter arrives via the model's activateControl interpretation
            (native checkboxes ignore Enter). */}
        <label className="inline-flex cursor-pointer items-center align-middle">
          <input
            type="checkbox"
            checked={field.isRequired}
            onChange={(event) => onToggleRequired(event.target.checked)}
            aria-label={t('extraction', 'gridRequiredToggleAria').replace(
              '{{label}}',
              field.label,
            )}
            data-cell-row={rowId}
            data-cell-cols="required"
            tabIndex={rovingTabIndex(focus, rowId, ['required'])}
            className="peer sr-only"
          />
          <RequiredBox checked={field.isRequired} />
        </label>
      </td>
      <td
        role="gridcell"
        className={cn('w-[26px] px-1', ringClass(focus, rowId, ['sparkle']))}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onDeepLink('ai')}
              aria-label={t('extraction', 'gridAiCellAria').replace(
                '{{label}}',
                field.label,
              )}
              data-cell-row={rowId}
              data-cell-cols="sparkle"
              tabIndex={rovingTabIndex(focus, rowId, ['sparkle'])}
              className="flex h-[18px] w-full items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {field.hasAiInstruction && (
                <Sparkles className="size-3 text-primary" aria-hidden />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t('extraction', 'gridAiCellAria').replace('{{label}}', field.label)}
          </TooltipContent>
        </Tooltip>
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
              disabled={deleteDisabled}
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
  onNewField,
  newFieldDisabled,
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
  /** Task 4: focuses the section's ghost editor (the old add dialog dies
   * in Task 8). Disabled while filtering — the ghost rows are hidden. */
  onNewField: () => void;
  newFieldDisabled: boolean;
  actions: TemplateSectionActions;
}) {
  // New-field and Rename both mount an autoFocus editor. Neither may
  // open from onSelect: the menu's FocusScope is still trapping at that
  // point and yanks focus straight back off the fresh editor — whose
  // blur is an auto-discard (ghost) or an instant rename exit. So
  // onSelect only FLAGS the intent and the open runs in
  // onCloseAutoFocus, after the trap is torn down, with the default
  // trigger-refocus prevented for that one hand-off. Every other close
  // keeps the a11y default.
  const menuClaimedFocus = useRef<'newField' | 'rename' | null>(null);
  // Task 6: the row owns rename MODE; the mounted editor owns the draft.
  // Both exits (commit, cancel) leave rename mode synchronously, so the
  // editor unmounts while focused and no blur-commit can double-fire
  // (the Task-3 exactly-once pattern).
  const [renaming, setRenaming] = useState(false);
  const labelButtonRef = useRef<HTMLButtonElement>(null);

  /** The label control remounts on the same flush that unmounts the
   * editor — focus it after that flush (the grid's focusCellSoon
   * pattern; still handler-originated, never an effect). */
  const focusLabelSoon = () => {
    queueMicrotask(() => labelButtonRef.current?.focus());
  };

  const commitRename = (draft: string, via: 'enter' | 'blur') => {
    setRenaming(false);
    const value = draft.trim();
    // An unchanged (or emptied) draft is a revert, never a write.
    if (value !== '' && value !== section.label) {
      actions.onCommitRename(section.id, value);
    }
    // On Enter the editor unmounts while focused (no blur follows) —
    // put focus back on the label control. On blur the world already
    // moved focus; stealing it back would fight the user.
    if (via === 'enter') focusLabelSoon();
  };

  const cancelRename = () => {
    setRenaming(false);
    focusLabelSoon();
  };

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
          {renaming ? (
            <SectionRenameEditor
              initialValue={section.label}
              rowId={section.id}
              spanCols={spanCols}
              tabIndex={rovingTabIndex(focus, section.id, spanColList)}
              onCommit={commitRename}
              onCancel={cancelRename}
            />
          ) : (
            <button
              ref={labelButtonRef}
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
          <DropdownMenuContent
            align="end"
            className="text-xs"
            onCloseAutoFocus={(event) => {
              const claimed = menuClaimedFocus.current;
              menuClaimedFocus.current = null;
              if (claimed === 'newField') {
                event.preventDefault();
                onNewField();
              } else if (claimed === 'rename') {
                event.preventDefault();
                setRenaming(true);
              }
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                menuClaimedFocus.current = 'newField';
              }}
              disabled={newFieldDisabled}
            >
              <Plus className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'gridNewField')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                menuClaimedFocus.current = 'rename';
              }}
            >
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

/**
 * Inline editor for a ghost row — the Enter-chain's input. Unlike
 * TextCellEditor it SURVIVES its own Enter-commit (the chain reopens the
 * same ghost, so the component clears its draft instead of unmounting)
 * and reports the empty↔non-empty flip so the model can distinguish
 * "Enter commits the next field" from "Enter exits the chain". Same
 * compiler-safe recipe: `autoFocus`, draft seeded from the typed key,
 * zero refs/effects.
 */
function GhostCellEditor({
  rowId,
  seed,
  onCommit,
  onCancel,
  onDraftEmptyChange,
}: {
  rowId: string;
  seed: string | null;
  onCommit: (draft: string, via: 'enter' | 'blur') => void;
  onCancel: () => void;
  onDraftEmptyChange: (empty: boolean) => void;
}) {
  const [draft, setDraft] = useState(seed ?? '');
  return (
    <Input
      value={draft}
      autoFocus
      aria-label={t('extraction', 'gridNewFieldAria')}
      placeholder={t('extraction', 'gridNewFieldPlaceholder')}
      data-cell-row={rowId}
      data-cell-cols="*"
      onChange={(event) => {
        const value = event.target.value;
        const wasEmpty = draft.trim() === '';
        const isEmpty = value.trim() === '';
        setDraft(value);
        if (wasEmpty !== isEmpty) onDraftEmptyChange(isEmpty);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onCommit(draft, 'enter');
          // The chain reopens this SAME editor — start the next field
          // empty. (On an exit the editor unmounts; the set is inert.)
          setDraft('');
        }
        if (event.key === 'Escape') {
          // Rung 1 belongs to the editor (see TextCellEditor).
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onBlur={() => onCommit(draft, 'blur')}
      className="h-6 text-xs"
    />
  );
}

function GhostRow({
  rowId,
  columnCount,
  indent,
  label,
  focus,
  onClick,
  editor,
  testId,
}: {
  rowId: string;
  columnCount: number;
  indent: string;
  label: string;
  focus: CellFocus;
  onClick: () => void;
  /** Inline-editing support (field ghosts only — the add-section ghost
   * keeps its button until sections go inline in B-8). */
  editor?: {
    editing: {seed: string | null} | null;
    onCommit: (draft: string, via: 'enter' | 'blur') => void;
    onCancel: () => void;
    onDraftEmptyChange: (empty: boolean) => void;
  };
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
        {editor?.editing ? (
          <GhostCellEditor
            rowId={rowId}
            seed={editor.editing.seed}
            onCommit={editor.onCommit}
            onCancel={editor.onCancel}
            onDraftEmptyChange={editor.onDraftEmptyChange}
          />
        ) : (
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
        )}
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
  onCommitField,
  onInsertField,
  onToggleRequired,
  onChangeType,
  onDeepLink,
  rowIdRemaps,
  pendingRowIds,
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
    coord: resolveFocusCoord(gridState.focus, rowShapes, columns, rowIdRemaps),
    within: focusWithin,
  };

  const isSelected = (kind: 'field' | 'section', id: string) =>
    selection?.kind === kind && selection.id === id;

  /** Interpret `activateControl` for the columns native activation cannot
   * cover (see INTERPRETED_CONTROL_COLUMNS). */
  const activateControlCell = (coord: CellCoord) => {
    const field = findField(sections, coord.rowId);
    if (!field) return;
    if (coord.column === 'required') onToggleRequired(field, !field.isRequired);
    else if (coord.column === 'sparkle') onDeepLink(field, 'ai');
    else if (coord.column === 'options') onDeepLink(field, 'options');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    if (event.defaultPrevented) return; // e.g. Radix trigger opened on ArrowDown
    const target = event.target as HTMLElement;
    // Text editors own their keys; the required CHECKBOX is an input too,
    // but not a text editor — its Enter/arrows still route to the model.
    if (target.closest('input:not([type="checkbox"]), textarea, [contenteditable="true"]')) {
      return;
    }
    const holder = target.closest<HTMLElement>('[data-cell-row]');
    if (!holder) return; // portal content (open menus) is not a cell
    const coord = coordFromTarget(holder, gridState.focus, columns);
    const cellKind = cellKindAt(coord, rowShapes);
    const printable = isPrintableKey(event) || event.key === 'Dead';
    const opensEditor =
      (cellKind === 'text' || cellKind === 'ghost') &&
      (event.key === 'Enter' || event.key === 'F2' || printable);
    const activatesControl =
      cellKind === 'control' &&
      (event.key === 'Enter' || event.key === 'F2') &&
      interpretsActivation(coord, rowShapes);
    if (!ROVING_KEYS.has(event.key) && !opensEditor && !activatesControl) return;
    let state = gridState;
    if (!state.focus || state.focus.rowId !== coord.rowId || state.focus.column !== coord.column) {
      state = gridReducer(state, {type: 'focusSync', coord});
    }
    const next = gridReducer(state, {
      type: 'key',
      key: event.key,
      printable,
      composing: event.nativeEvent.isComposing,
      cellKind,
      rows: rowShapes,
      columns,
    });
    for (const effect of next.effects) {
      if (effect.kind === 'escalateEsc') {
        // The central Esc dispatcher: rung 1 (cancelEdit) resolves in the
        // editor itself; rungs 2-3 are the panel's. stopPropagation keeps
        // the panel's own listener from double-firing.
        event.stopPropagation();
        onEscapeEscalate();
      }
      if (effect.kind === 'activateControl') {
        // Task 5: toggle the required checkbox / deep-link ✨ and Options.
        // preventDefault stops the native Enter-click on button cells so
        // the activation fires exactly once.
        event.preventDefault();
        activateControlCell(effect.coord);
      }
      // 'exitGrid' (Tab): deliberately NOT preventDefault-ed — the grid has
      // one tab stop, so native Tab already leaves it (APG).
      // 'commit' / 'cancelEdit' surface via the editor's own handlers.
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
    if (opensEditor && next.mode === 'edit') {
      // The editor mounts with the seed — the typed character must not
      // ALSO land natively, and Enter/Space must not click the button
      // (on a ghost row, Enter would otherwise ALSO fire its button).
      event.preventDefault();
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
    const holder = target.closest<HTMLElement>('[data-cell-row]');
    // Second click on the already-focused text cell edits (the model's
    // second-click transition). Detected at MOUSEDOWN time: by the click
    // event this gesture's own focusin has already synced the coordinate,
    // which would make every first click look like a second one.
    if (holder && document.activeElement === holder && gridState.mode === 'focus') {
      const coord = coordFromTarget(holder, gridState.focus, columns);
      if (cellKindAt(coord, rowShapes) === 'text') {
        event.preventDefault();
        setGridState(
          gridReducer(gridState, {
            type: 'click',
            coord,
            cellKind: 'text',
            rows: rowShapes,
          }),
        );
        return;
      }
    }
    if (target.closest('button, input, textarea, a, [contenteditable="true"]')) return;
    if (!(holder instanceof HTMLTableCellElement)) return;
    event.preventDefault();
    holder.focus();
  };

  /** The target may not exist until React flushes the state just set (the
   * editor unmounts, the cell's control remounts) — a microtask runs after
   * that flush. Still handler-originated: never an effect. */
  const focusCellSoon = (coord: CellCoord) => {
    queueMicrotask(() => findFocusTarget(tableRef.current, coord)?.focus());
  };

  /** What a commit effect writes to: a field's text cell, or a ghost row
   * drafting a NEW field. ONE interpreter for both — the model decides
   * when a commit happens; the target decides what it means. */
  type CommitTarget =
    | {kind: 'field'; field: GridField; column: TextCellColumn}
    | {kind: 'ghost'; sectionId: string};

  const handleEditorCommit = (
    target: CommitTarget,
    draft: string,
    via: 'enter' | 'blur',
  ) => {
    const next =
      via === 'enter'
        ? gridReducer(gridState, {
            type: 'key',
            key: 'Enter',
            cellKind: target.kind === 'ghost' ? 'ghost' : 'text',
            rows: rowShapes,
            columns,
          })
        : gridReducer(gridState, {type: 'blurCommit'});
    for (const effect of next.effects) {
      if (effect.kind !== 'commit') continue;
      const value = draft.trim();
      if (target.kind === 'field') {
        const current = target.column === 'label' ? target.field.label : target.field.key;
        // A no-change (or emptied) draft is a revert, never a write.
        if (value !== '' && value !== current) {
          onCommitField(target.field, target.column, value);
        }
      } else if (value !== '') {
        // Ghost commit: the panel enqueues the optimistic insert; the
        // chain keeps this editor mounted (a never-typed blur is a
        // discard — the empty value never reaches here as a write).
        onInsertField(target.sectionId, value);
      }
    }
    setGridState(next);
    // On Enter the commit owns where focus goes (down — or back onto the
    // reopened ghost editor); on blur the world already moved it —
    // stealing it back would fight the user.
    if (via === 'enter' && next.focus) focusCellSoon(next.focus);
  };

  const handleEditorCancel = () => {
    const next = gridReducer(gridState, {
      type: 'key',
      key: 'Escape',
      cellKind: 'text',
      rows: rowShapes,
      columns,
    });
    setGridState(next);
    // Esc keeps focus ON the cell: refocus its control once it remounts.
    if (next.focus) focusCellSoon(next.focus);
  };

  /** `＋ ▾` New-field and ghost-button clicks land here: open the
   * section's ghost editor (expanding a collapsed section first — the
   * editor mounts with autoFocus once the ghost row renders). */
  const openGhostEditor = (sectionId: string) => {
    if (collapsed.has(sectionId)) onToggleCollapse(sectionId);
    setGridState(
      gridReducer(gridState, {
        type: 'click',
        coord: {rowId: ghostRowId(sectionId), column: columns[0]},
        cellKind: 'ghost',
        rows: rowShapes,
      }),
    );
  };

  /** The ghost editor reports the empty↔non-empty flip so the model can
   * tell "Enter chains" from "Enter exits" (`setGhostDraftEmpty`). */
  const handleGhostDraftEmpty = (empty: boolean) => {
    const next = gridReducer(gridState, {type: 'setGhostDraftEmpty', empty});
    if (next !== gridState) setGridState(next);
  };

  /** Editor wiring for a section's ghost row (any column — the ghost
   * cell spans them all). */
  const ghostEditorFor = (sectionId: string) => {
    const rowId = ghostRowId(sectionId);
    return {
      editing:
        gridState.mode === 'edit' && focus.coord?.rowId === rowId
          ? {seed: gridState.editSeed}
          : null,
      onCommit: (draft: string, via: 'enter' | 'blur') =>
        handleEditorCommit({kind: 'ghost', sectionId}, draft, via),
      onCancel: handleEditorCancel,
      onDraftEmptyChange: handleGhostDraftEmpty,
    };
  };

  const renderFields = (fields: GridField[], indent: string) =>
    fields.map((field) => {
      const editing =
        gridState.mode === 'edit' &&
        focus.coord?.rowId === field.id &&
        (focus.coord.column === 'label' || focus.coord.column === 'key')
          ? {
              column: focus.coord.column as TextCellColumn,
              seed: gridState.editSeed,
            }
          : null;
      return (
        <FieldRow
          key={field.id}
          field={field}
          indent={indent}
          selected={isSelected('field', field.id)}
          focus={focus}
          editing={editing}
          onSelect={() => onSelect({kind: 'field', id: field.id})}
          onEdit={() => onEditField(field)}
          onDelete={() => onDeleteField(field)}
          deleteDisabled={pendingRowIds?.has(field.id) ?? false}
          onEditorCommit={(column, draft, via) =>
            handleEditorCommit({kind: 'field', field, column}, draft, via)
          }
          onEditorCancel={handleEditorCancel}
          onToggleRequired={(isRequired) => onToggleRequired(field, isRequired)}
          onChangeType={(fieldType) => onChangeType(field, fieldType)}
          onDeepLink={(group) => onDeepLink(field, group)}
          showKeyColumn={showKeyColumn}
          showOptionsColumn={showOptionsColumn}
        />
      );
    });

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
              onNewField={() => openGhostEditor(section.id)}
              newFieldDisabled={isFiltering}
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
                    onClick={() => openGhostEditor(section.id)}
                    editor={ghostEditorFor(section.id)}
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
                        onNewField={() => openGhostEditor(child.id)}
                        newFieldDisabled={isFiltering}
                        actions={sectionActions}
                      />
                      {!childCollapsed && (
                        <>
                          {renderFields(child.fields, INDENT.childField)}
                          {!isFiltering && (
                            <GhostRow
                              rowId={ghostRowId(child.id)}
                              columnCount={columnCount}
                              indent={INDENT.childField}
                              label={t('extraction', 'gridNewField')}
                              focus={focus}
                              onClick={() => openGhostEditor(child.id)}
                              editor={ghostEditorFor(child.id)}
                              testId={`template-grid-add-field-${child.id}`}
                            />
                          )}
                        </>
                      )}
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
