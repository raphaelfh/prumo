/**
 * UI copy for the template Configuration tab (template-config grid,
 * inspector, move/reorder). English only.
 *
 * ALL new B-6 strings (move, reorder, drag, undo, command menu) land in
 * THIS namespace — `lib/copy/extraction.ts` sits at its file-size ratchet
 * ceiling and must not grow.
 */
export const templateConfig = {
  errors_moveField: 'Error moving field',
  errors_reorderFields: 'Error reordering fields',
  moveAnnouncement: 'Moved {{field}} to {{section}}, position {{position}} of {{count}}',
  undoAction: 'Undo',
  undoFieldMissing: 'This field no longer exists — nothing to undo',
  undoMoveToast: 'Moved {{field}}',
} as const;
