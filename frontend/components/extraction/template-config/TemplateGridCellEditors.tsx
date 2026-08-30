import {useState} from 'react';

import {Input} from '@/components/ui/input';
import {t} from '@/lib/copy';

/**
 * Inline editor for a text cell — the compiler-safe recipe (plan Global
 * Constraints): `autoFocus` + `onFocus` select() for focus-then-edit, the
 * draft seeded from the typed key for typing-replaces, zero refs/effects
 * for focus. Mounted only while the model is in edit mode on this cell,
 * so `useState` re-seeds per edit session. Height-capped like the h-6
 * rename input to preserve the 30px rows.
 */
export function TextCellEditor({
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
      className="h-6 text-[13px]"
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
export function SectionRenameEditor({
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
      className="h-6 max-w-[220px] text-[13px]"
    />
  );
}
