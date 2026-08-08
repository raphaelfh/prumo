import {useState} from 'react';
import {ChevronDown, FolderPlus, Plus} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Input} from '@/components/ui/input';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import {ringClass, rovingTabIndex, type CellFocus} from './gridCellFocus';
import {ADD_SECTION_ROW_ID} from './gridRowShapes';

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

export function GhostRow({
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
  /** Inline-editing support (field ghosts only). Dialog-opening ghosts —
   * the per-group "New per-model section" row — omit it and keep their
   * button: AddSectionDialog is the PERMANENT create surface for
   * sections (inline section creation was dropped in the B-8 plan). */
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

/**
 * The template-level add row as a `＋▾` menu (B-8 D8/D12): "New section"
 * opens AddSectionDialog in root mode; "Add repeating group…" opens it
 * in group mode — DISABLED (with a tooltip naming the existing group)
 * once the tree has one, since a template holds at most one container
 * (DB partial-unique index, 0016). Both are dialog-opening items: they
 * fire on select directly, no editor-focus claim. The trigger keeps the
 * ghost row's look and its roving-focus coordinates.
 */
export function AddSectionMenuRow({
  columnCount,
  focus,
  existingGroupLabel,
  onAddSection,
  onAddGroup,
}: {
  columnCount: number;
  focus: CellFocus;
  /** The current group's label when one exists — disables the add-group
   * item and names the reason; null when the template has none yet. */
  existingGroupLabel: string | null;
  onAddSection: () => void;
  onAddGroup: () => void;
}) {
  return (
    <tr className="h-[30px] border-b border-border/50">
      <td role="gridcell" />
      <td
        role="gridcell"
        colSpan={columnCount - 1}
        className={cn('px-2 pl-2', ringClass(focus, ADD_SECTION_ROW_ID, '*'))}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="template-grid-add-section"
              data-cell-row={ADD_SECTION_ROW_ID}
              data-cell-cols="*"
              tabIndex={rovingTabIndex(focus, ADD_SECTION_ROW_ID, '*')}
              className="inline-flex items-center gap-1 rounded italic text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3" aria-hidden />
              {t('templateConfig', 'addSectionMenu')}
              <ChevronDown className="size-2.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="text-xs">
            <DropdownMenuItem onSelect={onAddSection}>
              <Plus className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'gridNewSection')}
            </DropdownMenuItem>
            {existingGroupLabel === null ? (
              <DropdownMenuItem onSelect={onAddGroup}>
                <FolderPlus className="mr-2 size-3.5" aria-hidden />
                {t('templateConfig', 'addRepeatingGroup')}
              </DropdownMenuItem>
            ) : (
              <Tooltip>
                {/* A disabled Radix item is pointer-events:none — the
                    wrapping span carries the hover for the reason. */}
                <TooltipTrigger asChild>
                  <span tabIndex={-1}>
                    <DropdownMenuItem disabled>
                      <FolderPlus className="mr-2 size-3.5" aria-hidden />
                      {t('templateConfig', 'addRepeatingGroup')}
                    </DropdownMenuItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t('templateConfig', 'addGroupExistsTooltip').replace(
                    '{{label}}',
                    existingGroupLabel,
                  )}
                </TooltipContent>
              </Tooltip>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
