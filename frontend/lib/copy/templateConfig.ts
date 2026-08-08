/**
 * UI copy for the template Configuration tab (template-config grid,
 * inspector, move/reorder). English only.
 *
 * ALL new B-6 strings (move, reorder, drag, undo, command menu) land in
 * THIS namespace — `lib/copy/extraction.ts` sits at its file-size ratchet
 * ceiling and must not grow.
 */
export const templateConfig = {
  dragCancelled: 'Move cancelled — {{field}} stays where it was',
  dragHandleHint: 'Drag to reorder',
  dragLockedFiltering: 'Clear search to reorder',
  dragLockedPending: 'Wait for the new field to finish saving',
  dragPickedUp: 'Picked up {{field}}',
  errors_deleteSectionInUse:
    'This section cannot be deleted: extraction work (proposals, decisions, or published values) already references its fields.',
  errors_duplicateFieldName:
    'A field with this name already exists in this section.',
  errors_moveField: 'Error moving field',
  errors_reorderFields: 'Error reordering fields',
  menuMoveDown: 'Move down',
  menuMoveToSection: 'Move to section…',
  menuMoveUp: 'Move up',
  moveAnnouncement: 'Moved {{field}} to {{section}}, position {{position}} of {{count}}',
  moveDialogEmpty: 'No section matches',
  moveDialogHeading: 'Sections',
  moveDialogPlaceholder: 'Move {{field}} to…',
  moveDialogTitle: 'Move field to a section',
  shortcutMoveDown: '⌘⇧↓',
  shortcutMoveToSection: '⌘⇧M',
  shortcutMoveUp: '⌘⇧↑',
  undoAction: 'Undo',
  undoFieldMissing: 'This field no longer exists — nothing to undo',
  undoMoveToast: 'Moved {{field}}',
} as const;
