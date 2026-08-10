import {useRef} from 'react';
import {useSortable} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  Check,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import {ringClass, rovingTabIndex, type CellFocus} from './gridCellFocus';
import {TextCellEditor} from './TemplateGridCellEditors';
import {
  FIELD_TYPE_OPTIONS,
  type GridField,
  type TemplateMatchHint,
} from './templateTree';

/** Columns that edit inline as free text. */
export type TextCellColumn = 'label' | 'key';

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

/** Why a row cannot be dragged right now — doubles as the handle's
 * hover copy (B-6 T6: the reason surfaces where the affordance is). */
export type DragLockReason = 'filtering' | 'pending';

const DRAG_HINT_COPY = {
  enabled: 'dragHandleHint',
  filtering: 'dragLockedFiltering',
  pending: 'dragLockedPending',
} as const;

/** Row-menu move affordances (B-6 T7, panel decision 5): the visible,
 * single-pointer (WCAG 2.5.7) counterpart of the invisible ⌘⇧ chords.
 * The GRID computes the disabled matrix — template edges via
 * `nextMoveSlot`, filtering, pending rows — and routes dispatch through
 * the panel's `moveFieldWithUndo` chokepoint. */
export interface FieldRowMoveActions {
  upDisabled: boolean;
  downDisabled: boolean;
  toSectionDisabled: boolean;
  onStep: (delta: 1 | -1) => void;
  /** Requests the panel-hosted "Move to section…" dialog (ONE instance
   * for the whole grid) — dispatched via the menu's focus hand-off. */
  onToSection: () => void;
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

export function FieldRow({
  field,
  indent,
  selected,
  focus,
  editing,
  onSelect,
  onDelete,
  deleteDisabled,
  dragLocked,
  move,
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
  onDelete: () => void;
  /** True on pending optimistic rows — see `pendingRowIds`. */
  deleteDisabled: boolean;
  /** Non-null disables the drag handle, naming why (B-6 T6). */
  dragLocked: DragLockReason | null;
  /** The ⋯ menu's Move up/down/to-section items (B-6 T7). */
  move: FieldRowMoveActions;
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
  // Panel decision 9 (the SectionHeaderRow hand-off, replicated here):
  // the "Move to section…" dialog must NOT open from onSelect — the
  // menu's FocusScope is still trapping at that point and would yank
  // focus off (and fight) the fresh dialog's own trap. So onSelect only
  // FLAGS the intent and the open runs in onCloseAutoFocus, after the
  // trap is torn down, with the default trigger-refocus prevented for
  // that one hand-off. Every other close keeps the a11y default.
  const menuClaimedFocus = useRef<'moveToSection' | null>(null);
  // B-6 T6: the row is a sortable item and the ⠿ td its ONLY activator.
  // useSortable's `attributes` is deliberately NOT destructured — it
  // injects tabIndex=0 + role="button" on the activator: a second tab
  // stop that breaks the grid's one-tab-stop roving invariant. The
  // handle stays a pointer-only affordance; keyboard moves are the ⌘⇧
  // chords + the inspector Section combobox. Inert (empty listeners,
  // null transform) outside a DndContext, so grid-only hosts and the
  // frozen tests render unchanged.
  const {isDragging, listeners, setActivatorNodeRef, setNodeRef, transform, transition} =
    useSortable({id: rowId, disabled: dragLocked !== null});
  return (
    <tr
      ref={setNodeRef}
      data-testid="template-grid-field-row"
      style={{transform: CSS.Transform.toString(transform), transition}}
      className={cn(
        'group/row h-[30px] border-b border-border/50 hover:bg-muted/40',
        selected && 'bg-muted/60',
        isDragging && 'relative z-10 opacity-60',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <td
            role="gridcell"
            ref={setActivatorNodeRef}
            {...(dragLocked === null ? listeners : undefined)}
            data-drag-locked={dragLocked ?? undefined}
            className={cn(
              'w-3.5 px-2 text-muted-foreground/60',
              dragLocked === null && 'cursor-grab touch-none active:cursor-grabbing',
            )}
          >
            <GripVertical className="size-3" aria-hidden />
          </td>
        </TooltipTrigger>
        <TooltipContent>
          {t('templateConfig', DRAG_HINT_COPY[dragLocked ?? 'enabled'])}
        </TooltipContent>
      </Tooltip>
      <td
        role="gridcell"
        className={cn('min-w-0 px-2', indent, ringClass(focus, rowId, ['label']))}
      >
        {/* The roving target is the button, not the td: Enter/Space select
            natively; a second click / Enter / F2 / typing swaps it for the
            inline editor (the model's text-cell transitions). */}
        {/* The row itself carries no handlers: a click target that also lives
            on the <tr> fires twice for nested controls, and `stopPropagation`
            on `click` does NOT stop `dblclick` — a double-click on the ⋯ menu
            would also hit whatever the row bound behind it. */}
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
          <DropdownMenuContent
            align="end"
            className="text-xs"
            onCloseAutoFocus={(event) => {
              const claimed = menuClaimedFocus.current;
              menuClaimedFocus.current = null;
              if (claimed === 'moveToSection') {
                event.preventDefault();
                move.onToSection();
              }
            }}
          >
            <DropdownMenuItem
              onSelect={() => move.onStep(-1)}
              disabled={move.upDisabled}
            >
              <ArrowUp className="mr-2 size-3.5" aria-hidden />
              {t('templateConfig', 'menuMoveUp')}
              <DropdownMenuShortcut>
                {t('templateConfig', 'shortcutMoveUp')}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => move.onStep(1)}
              disabled={move.downDisabled}
            >
              <ArrowDown className="mr-2 size-3.5" aria-hidden />
              {t('templateConfig', 'menuMoveDown')}
              <DropdownMenuShortcut>
                {t('templateConfig', 'shortcutMoveDown')}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                menuClaimedFocus.current = 'moveToSection';
              }}
              disabled={move.toSectionDisabled}
            >
              <FolderInput className="mr-2 size-3.5" aria-hidden />
              {t('templateConfig', 'menuMoveToSection')}
              <DropdownMenuShortcut>
                {t('templateConfig', 'shortcutMoveToSection')}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
