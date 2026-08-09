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
  // --- B-9c2: Discard the unpublished draft (button + four-phase dialog) ---
  discardAckAction: 'Discard anyway',
  discardAckBody:
    'Reviewers already recorded answers for these fields. Discarding removes the options — or changes the type — those answers were recorded under, so they will no longer match the template:',
  discardAckTitle: 'Some recorded answers will be left behind',
  discardButton: 'Discard',
  // Constant accessible name (the tooltip carries the state). Deliberately
  // free of the word "publish" so it can never collide with the sibling
  // Publish button in a by-name lookup.
  discardButtonAria: 'Discard draft changes',
  discardConfirmAction: 'Discard changes',
  discardConfirmBodyOne: 'Undo {{n}} unpublished change and go back to v{{v}}.',
  discardConfirmBodyOther: 'Undo {{n}} unpublished changes and go back to v{{v}}.',
  // Fallback for the degenerate shapes (a marker stamped with a zero diff,
  // or a status without a version): true without inventing a number.
  discardConfirmBodyPlain:
    'Undo the unpublished changes and go back to the published version.',
  discardConfirmInstruction:
    'The template’s general AI instruction goes back to its published text too.',
  // D11: a wide-but-older baseline can rewrite columns the diff does not
  // count, so the pane states the SCOPE and never promises an inventory.
  discardConfirmScope:
    'Everything edited since the last publish returns to how it was then. This cannot be undone.',
  discardConfirmTitle: 'Discard the unpublished changes?',
  // D5 fifth outcome: an unknown code, a non-409, or a dead connection. Not
  // a policy refusal, so it must not read like one.
  discardFailedGeneric:
    'The changes could not be discarded. Check your connection and try again.',
  discardKeptKindField: 'Field',
  discardKeptKindSection: 'Section',
  discardKeptReasonHasRecordedData: 'reviewers already recorded answers for it',
  discardKeptReasonNameTakenByKeptNode:
    'another item that had to stay is using its name',
  // D9 runtime fallback — t() returns '' for a missing key, which would
  // render a labelled row with no explanation at all.
  discardKeptReasonOther: 'this item could not be restored',
  discardKeptReasonRelatedToKeptNode: 'it belongs to an item that had to stay',
  discardRefusedCardinality:
    'The published version expects one entry for a section that now holds several in at least one run. Restoring it would leave those runs impossible to complete.',
  discardRefusedContainerSwap:
    'The draft replaced this template’s repeating group. Discarding that particular change is not supported — undo it by hand in the grid instead.',
  discardRefusedNarrowBaseline:
    'The published version was saved in an older format, so restoring it would erase AI instructions and option settings across the template.',
  discardRefusedRaced:
    'Someone recorded work on this template while the discard was running. Nothing was changed — try again.',
  discardRefusedTitle: 'These changes cannot be discarded',
  discardResultStillDraft:
    'Everything else went back to the published version, but these items had to stay — so the template is still a draft. Publish when you are ready.',
  discardResultTitle: 'Some items could not be undone',
  discardSuccessToast: 'Unpublished changes discarded',
  discardTooltipAction:
    'Undo the draft changes and go back to the last version you released',
  discardTooltipBaselineTooOld: 'The published version is too old to restore from',
  discardTooltipNeverPublished:
    'Nothing has been published yet, so there is no version to go back to',
  discardTooltipNothing: 'Nothing to discard — there are no draft changes',
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
  // B-9b0 D4: the publish refusal, composed here from the server's CODE and
  // its section labels — never its prose. The nameless variant is the
  // degenerate payload (labels missing or malformed): still a policy
  // refusal, so it must not read like a server fault.
  errors_publishBlockedOne:
    'Cannot publish: the section {{sections}} is set to appear once per entry, but an entry still holds several. Remove the extra entries first.',
  errors_publishBlockedOther:
    'Cannot publish: the sections {{sections}} are set to appear once per entry, but an entry still holds several. Remove the extra entries first.',
  errors_publishBlockedPlain:
    'Cannot publish: a section is set to appear once per entry, but an entry still holds several. Remove the extra entries first.',
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
  // B-9c2 T3 (D8): the editor's THIRD render branch. A failed structure
  // read must never be dressed up as "this template has no sections".
  // Reserved for a read that returned NOTHING — with rows cached the copy
  // below is the honest one (the sections ARE shown, just not refreshed).
  sectionsLoadFailedBody:
    'The template structure could not be read, so the sections are not shown. Check your connection and try again.',
  sectionsLoadFailedTitle: 'Couldn’t load the sections',
  // The non-blocking counterpart: the refresh failed but the structure is
  // still cached, so the tab keeps working and only says it may be behind.
  sectionsRefreshFailedBody:
    'The sections could not be refreshed, so they may not include your latest changes. Check your connection and try again.',
  sectionUpdatedSuccess: 'Section updated',
  shortcutMoveDown: '⌘⇧↓',
  shortcutMoveToSection: '⌘⇧M',
  shortcutMoveUp: '⌘⇧↑',
  undoAction: 'Undo',
  undoFieldMissing: 'This field no longer exists — nothing to undo',
  undoMoveToast: 'Moved {{field}}',
} as const;
