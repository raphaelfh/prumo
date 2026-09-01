import {useRef, useState} from 'react';
import {useDroppable} from '@dnd-kit/core';
import {
  ChevronRight,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import {ringClass, rovingTabIndex, type CellFocus} from './gridCellFocus';
import {SectionRenameEditor} from './TemplateGridCellEditors';
import {DescriptionDot} from './templateConfigAtoms';
import type {GridSection} from './templateTree';

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
  /** Opens AddSectionDialog in per-model mode preset to this GROUP (B-8
   * D8) — reached from the group menu and the per-group ghost row. */
  onAddPerModelSection: (group: GridSection) => void;
}

export function SectionHeaderRow({
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
  /** Task 4: focuses the section's ghost editor. Disabled while
   * filtering — the ghost rows are hidden. */
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

  // B-6 T6: the header row is a drop target keyed by the section id —
  // dropping a dragged field on it lands at the section's END when
  // collapsed (its rows are invisible; panel decision 4) and the TOP
  // slot when expanded (see resolveDropSlot). Inert without a DndContext.
  const {setNodeRef: setDropRef, isOver} = useDroppable({id: section.id});

  // B-8 D7: meta copy interpolates the group's entry noun ('{{noun}}'
  // placeholder convention); keys without the placeholder pass through.
  const meta = [
    ...section.metaKeys.map((key) =>
      t('extraction', key).replace('{{noun}}', section.entryNoun),
    ),
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
      ref={setDropRef}
      data-testid="template-grid-section-row"
      className={cn(
        'h-8 border-b border-border/50 bg-muted/50',
        isOver && 'bg-primary/10',
      )}
    >
      <td role="gridcell" className="w-3.5 px-2 text-muted-foreground/60">
        <GripVertical className="size-3" aria-hidden />
      </td>
      <td
        role="gridcell"
        colSpan={columnCount - 2}
        className={cn('px-2', indent, ringClass(focus, section.id, cellCols))}
      >
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={`${t('extraction', collapsed ? 'gridExpandSection' : 'gridCollapseSection')} — ${section.label}`}
            data-cell-row={section.id}
            data-cell-cols="label"
            tabIndex={rovingTabIndex(focus, section.id, ['label'])}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* ONE glyph that rotates, not two that swap: the open/closed
                states then read as the same affordance moving, and the
                arrow keeps a single optical centre inside its 24px box.
                A swap re-centres the icon on every toggle (Down is wider
                than Right) and nudged the label sideways. */}
            <ChevronRight
              className={cn(
                'size-3.5 transition-transform duration-150 motion-reduce:transition-none',
                !collapsed && 'rotate-90',
              )}
              aria-hidden
            />
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
              className="min-h-6 truncate rounded text-left font-semibold leading-6 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.label}
            </button>
          )}
          {section.hasDescription && <DescriptionDot />}
          <span className="truncate text-[11px] text-muted-foreground">
            · {meta.join(' · ')}
          </span>
        </div>
      </td>
      <td
        role="gridcell"
        // px-1, matching the field row's actions cell: the column is 34px
        // wide, so px-2 leaves 18px of content box and anything larger
        // overflows the table's right edge and is clipped by the scroller.
        className={cn('px-1 text-right', ringClass(focus, section.id, ['actions']))}
      >
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${t('extraction', 'gridSectionActions')} — ${section.label}`}
                  data-cell-row={section.id}
                  data-cell-cols="actions"
                  tabIndex={rovingTabIndex(focus, section.id, ['actions'])}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground"
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('extraction', 'gridSectionActions')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
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
            {section.kind === 'group' && (
              // Dialog-opening item (B-8 D8): fires on select directly —
              // the dialog's own focus trap takes over after the menu's
              // FocusScope tears down, so no editor claim is needed.
              <DropdownMenuItem onSelect={() => actions.onAddPerModelSection(section)}>
                <FolderPlus className="mr-2 size-3.5" aria-hidden />
                {t('templateConfig', 'newPerModelSection').replace(
                  '{{noun}}',
                  section.entryNoun,
                )}
              </DropdownMenuItem>
            )}
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
              {/* D4: a group's delete states what it is — a cascade over
                  the whole block. B-9d: it dispatches immediately (no
                  confirm dialog); the 6s Undo toast is the safety net. */}
              {section.kind === 'group'
                ? t('templateConfig', 'deleteRepeatingGroup')
                : t('extraction', 'removeButton')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
