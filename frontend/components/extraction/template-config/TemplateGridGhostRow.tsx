import {useState} from 'react';
import {Plus} from 'lucide-react';

import {Input} from '@/components/ui/input';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import {ringClass, rovingTabIndex, type CellFocus} from './gridCellFocus';

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
