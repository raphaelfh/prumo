/**
 * UI copy for the template Configuration tab (template-config grid,
 * inspector, move/reorder). English only.
 *
 * ALL new B-6 strings (move, reorder, drag, undo, command menu) land in
 * THIS namespace — `lib/copy/extraction.ts` sits at its file-size ratchet
 * ceiling and must not grow.
 */
export const templateConfig = {
  addGroupDialogDesc:
    'A repeating group collects the entries reviewers add in the run view; the sections inside it repeat once per entry.',
  addGroupDialogTitle: 'Add repeating group',
  addGroupExistsTooltip: 'This template already has a repeating group ({{label}}).',
  addRepeatingGroup: 'Add repeating group…',
  addSectionDialogDesc: 'Create a custom section to extract project-specific data.',
  addSectionMenu: 'Add section',
  cardinalityOncePerModel: 'Once per {{noun}}',
  cardinalityRepeatsPerModel: 'Repeats per {{noun}}',
  cardinalityRootInfo:
    'Single for data that appears once per article; multiple allows several instances (e.g. a list or table).',
  cardinalityRootMultipleHint: 'Multiple occurrences per article (e.g. Authors, Groups)',
  cardinalityRootSingleHint: 'One occurrence per article (e.g. Summary, Conclusion)',
  deleteGroupCascadeWarning:
    'Deleting this repeating group also deletes {{children}} per-{{noun}} section(s) inside it and their {{fields}} field(s)',
  deleteRepeatingGroup: 'Delete repeating group…',
  // B-9a: shown only for a POSITIVE server-computed count; 0 and null both
  // fall back to extraction.configUnpublishedChanges (D9).
  draftChangeCountOne: 'Draft · {{n}} change',
  draftChangeCountOther: 'Draft · {{n}} changes',
  dragCancelled: 'Move cancelled — {{field}} stays where it was',
  dragHandleHint: 'Drag to reorder',
  dragLockedFiltering: 'Clear search to reorder',
  dragLockedPending: 'Wait for the new field to finish saving',
  dragPickedUp: 'Picked up {{field}}',
  entryLabelHint:
    'What reviewers call one entry (e.g. model, arm, algorithm). Blank defaults to "model".',
  entryLabelLabel: 'Entry label',
  entryLabelMax50: 'Entry label must have at most 50 characters',
  entryLabelPlaceholder: 'model',
  errors_cardinalityInUse:
    'This section cannot be set to repeat once: it already has multiple entries under at least one group entry. Remove the extra entries first.',
  errors_deleteSectionInUse:
    'This section cannot be deleted: extraction work (proposals, decisions, or published values) already references its fields.',
  errors_duplicateFieldName:
    'A field with this name already exists in this section.',
  errors_moveField: 'Error moving field',
  errors_reorderFields: 'Error reordering fields',
  errors_updateSection: 'Error updating section',
  inspectorGroupAlwaysRepeats: 'A group always repeats',
  inspectorGroupKindLine: 'Repeating group — reviewers add one entry per {{noun}}',
  inspectorInsideGroup: 'Inside {{group}}',
  inspectorPlacementLabel: 'Placement',
  inspectorRepeatsLabel: 'Repeats',
  menuMoveDown: 'Move down',
  menuMoveToSection: 'Move to section…',
  menuMoveUp: 'Move up',
  moveAnnouncement: 'Moved {{field}} to {{section}}, position {{position}} of {{count}}',
  moveDialogEmpty: 'No section matches',
  moveDialogHeading: 'Sections',
  moveDialogPlaceholder: 'Move {{field}} to…',
  moveDialogTitle: 'Move field to a section',
  newPerModelSection: 'New per-{{noun}} section',
  perModelDialogDesc:
    'Lives inside {{group}} — reviewers fill it once for each {{noun}}.',
  // Capitalized inspector variants — the extraction-namespace meta keys
  // ('repeats per article') are lowercase inline-meta styling.
  repeatsOncePerArticle: 'One per article',
  repeatsPerArticle: 'Repeats per article',
  sectionUpdatedSuccess: 'Section updated',
  shortcutMoveDown: '⌘⇧↓',
  shortcutMoveToSection: '⌘⇧M',
  shortcutMoveUp: '⌘⇧↑',
  undoAction: 'Undo',
  undoFieldMissing: 'This field no longer exists — nothing to undo',
  undoMoveToast: 'Moved {{field}}',
} as const;
