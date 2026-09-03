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
  // --- B-9b2a: the read-only "unpublished changes" sheet (D7/D8) ---
  //
  // One sentence per generated ChangeVariant. The map in
  // TemplateConfigDiffSheet is `satisfies Record<ChangeVariant, CopyKey>`,
  // so a wire change breaks the typecheck instead of shipping a blank row.
  changeEntityTypeAdded: 'Section added',
  // D8: fields reordered INSIDE a section. Entity types themselves never
  // reorder, so this must never say "sections were reordered". The count is
  // the POPULATION of fields that survived in the section on both sides
  // (template_diff._diff_field_order excludes ids that were added, removed,
  // or re-parented) — NOT the number that swapped places. A single swap
  // among five survivors still reports 5, so the sentence names the
  // population, never the movers — which is also why this and
  // `changeFieldOptionsReordered` cannot be one shared string (this one
  // excludes just-added fields; the options one includes just-added
  // options).
  changeEntityTypeFieldsReordered: 'Order changed among {{n}} fields in this section',
  changeEntityTypeModified: 'Section changed',
  changeEntityTypeRemoved: 'Section removed',
  changeFieldAdded: 'Field added',
  changeFieldModified: 'Field changed',
  changeFieldMoved: 'Field moved to another section',
  changeFieldOptionAdded: 'Option added',
  changeFieldOptionRemoved: 'Option removed',
  // D8: the option count INCLUDES options added in the same diff
  // (template_diff._diff_options reports len(new) over the whole new list),
  // so "N options reordered" would claim N moves that did not happen. The
  // honest phrasing names the population, not the moves.
  changeFieldOptionsReordered: 'Order changed among {{n}} options',
  changeFieldRemoved: 'Field removed',
  // Degenerate reorder row (no count on the wire): says the direction of
  // the change without inventing arithmetic for either population.
  changeReorderPlain: 'Order changed',
  changeTemplateInstructionAdded: 'AI instruction added',
  changeTemplateInstructionModified: 'AI instruction changed',
  changeTemplateInstructionRemoved: 'AI instruction removed',
  // Runtime `??` fallback for a server ahead of this bundle — t() answers
  // an unknown key with '', which would render a row with no sentence.
  changeUnknown: 'Changed',
  deleteGroupCascadeWarning:
    'Deleting this repeating group also deletes {{children}} per-{{noun}} section(s) inside it and their {{fields}} field(s)',
  deleteRepeatingGroup: 'Delete repeating group…',
  // Attribute names, so a row says "Required" instead of "is_required".
  // Descriptive only: NO row claims a downstream effect, which is what
  // `validation_schema` requires (it has no functional reader anywhere in
  // the product) and what every other attribute gets for free.
  diffAttrAllowedUnits: 'Allowed units',
  diffAttrAllowedValues: 'Options',
  diffAttrAllowOther: '“Other” option',
  diffAttrAllowsNoInformation: '“No information” option',
  diffAttrAllowsNotApplicable: '“Not applicable” option',
  diffAttrAllowsNotEvaluated: '“Not evaluated” option',
  diffAttrCardinality: 'Repeats',
  diffAttrDescription: 'Description',
  diffAttrEntryLabel: 'Entry label',
  diffAttrFieldType: 'Field type',
  diffAttrIsEntityKey: 'Entry key',
  diffAttrIsRequired: 'Required',
  diffAttrLabel: 'Label',
  diffAttrLlmDescription: 'AI instruction',
  diffAttrLlmTemplateInstruction: 'AI instruction',
  diffAttrName: 'Key',
  diffAttrOtherLabel: '“Other” label',
  diffAttrOtherPlaceholder: '“Other” placeholder',
  diffAttrParentEntityTypeId: 'Parent section',
  diffAttrRole: 'Role',
  diffAttrUnit: 'Unit',
  diffAttrValidationSchema: 'Validation schema',
  // D8: reuses the discardTooltipBaselineTooOld framing. It must not read
  // as "no changes" — the draft HAS changes, they just cannot be listed.
  diffBaselineTooOld:
    'The published version is too old to compare against, so this draft’s changes cannot be listed.',
  // The genuinely empty diff: the marker is stamped but the snapshots
  // match. Here "nothing different" is the true statement.
  diffEmpty:
    'This draft matches the published version — there is nothing different to list.',
  // D8: defensive only (migration 0004 plus template_clone_service publish
  // v1 in the same transaction), and still never "no changes".
  diffInitialVersion:
    'Nothing has been published yet, so there is no version to compare against. Everything in this template is new.',
  diffLoadFailed:
    'The changes could not be read. Check your connection and try again.',
  diffLoading: 'Reading the changes…',
  // D6: destructive rows only. The set behind it unions AI and system
  // proposals with human ones, so it can never say "answers".
  diffRecordedWork: 'Affects recorded extraction work',
  diffSheetDescription:
    'What this draft would publish. Read-only — nothing here changes the template.',
  diffSheetTitle: 'Unpublished changes',
  diffTierAdditive: 'New items',
  // Both reorder variants land in this tier (template_diff.py:601,:649), and
  // reordering is not wording — so this cannot say "Wording only" without
  // misdescribing every reorder row grouped under it.
  diffTierCosmetic: 'Wording and order',
  diffTierDestructive: 'Removes or replaces',
  diffTierSemantic: 'Changes meaning',
  diffTriggerTooltip: 'See what this draft would publish',
  // D3: an opaque value (a blob or an id) has nothing listable to print, so
  // the wire ships a STATE and the word is chosen here — the server no
  // longer sends English. `empty` is a present-but-empty container; an
  // attribute that was never set ships no state at all and prints nothing.
  diffValueEmpty: 'empty',
  diffValueSet: 'set',
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
  errors_restoreField: 'Could not restore the field',
  errors_restoreSection: 'Could not restore the section — some of it may be missing',
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
  // B-9b2b: the two contract refusals. Drift is recoverable and says so —
  // the sheet has already reloaded by the time this is read, and every
  // acknowledgement was cleared, so the ask is to look again rather than to
  // retry. The missing-ack sentence is a fallback: the button is disabled
  // until every destructive row is ticked, so reaching it means the sheet
  // and the server disagreed.
  // B-9b2b: the acknowledgement gate. The row sentence is interpolated so
  // the checkbox has a real accessible name — a bare "confirm" checkbox
  // beside a list of changes tells a screen-reader user nothing.
  diffAckRowAria: 'Confirm this change: {{change}}',
  publishAckPending:
    '{{n}} change(s) still need confirming before you can publish.',
  publishNoteLabel: 'Note (optional)',
  publishNotePlaceholder: 'Why are you publishing these changes?',
  publishNoteNotRecorded:
    'Nothing had changed, so no new version was created and your note was not saved.',
  errors_publishDrifted:
    'These changes moved while you were reviewing them. The list has been reloaded — check it and confirm again.',
  errors_publishMissingAck:
    'Cannot publish: every change that removes or rewrites recorded data has to be confirmed first.',
  errors_reorderFields: 'Error reordering fields',
  errors_updateSection: 'Error updating section',
  // B-9e History. The timeline shows absolute timestamps on purpose:
  // versions are read against each other, so "3 days ago" is useless.
  historySheetTitle: 'Version history',
  historySheetDescription:
    'Every published version of this template, newest first.',
  historyVersionLabel: 'Version {{n}}',
  historyActiveBadge: 'Current',
  historyPublishedBy: 'Published by {{who}} on {{when}}',
  historyUnknownAuthor: 'an unknown user',
  historyPinnedRunsOne: '{{n}} extraction still uses this version',
  historyPinnedRunsOther: '{{n}} extractions still use this version',
  historyLoading: 'Reading the history…',
  historyLoadFailed:
    'The version history could not be loaded. This does not mean the template has none — try again.',
  historyEmpty: 'This template has not been published yet.',
  // B-9f — the advisory editor lock. "held by" never names a raw id: an
  // unattributed draft (pre-0053, or a raw PostgREST write) reads as a
  // plain draft with no owner and offers no takeover, because there is
  // nobody to take it from.
  draftHeldBy: 'Being edited by {{who}}',
  draftTakeOver: 'Take over',
  draftTakeOverTooltip:
    'Continue editing this draft yourself. Nothing is lost — there is only one draft, and their changes are already in it.',
  draftTakeOverSuccess: 'You are now editing this draft.',
  draftTakeOverFrom: 'You took over the draft from {{who}}.',
  errors_draftLockHeld:
    'Someone else is editing this configuration. Take over the draft to continue.',
  errors_draftLockHeldBy:
    '{{who}} is editing this configuration. Take over the draft to continue.',
  errors_takeOverDraft: 'Could not take over the draft',
  historyTriggerTooltip: 'See every published version',
  historyRestoreAction: 'Restore',
  historyRestoreTooltip:
    'Bring this version back as an unpublished draft — nothing is overwritten until you publish',
  historyRestoreSuccess:
    'Version {{n}} is staged as a draft. Review it and publish when ready.',
  historyRestoreNoop:
    'Version {{n}} already matches the current configuration, so nothing changed.',
  historyRestoreKept:
    '{{n}} item(s) could not be brought back because they hold recorded answers.',
  errors_restoreVersion: 'Could not restore that version',
  inspectorGroupAlwaysRepeats: 'A group always repeats',
  inspectorGroupKindLine: 'Repeating group — reviewers add one entry per {{noun}}',
  inspectorInsideGroup: 'Inside {{group}}',
  inspectorPlacementLabel: 'Placement',
  inspectorRepeatsLabel: 'Repeats',
  // 0059: which field identifies one entry of a repeating section, so an
  // AI re-run recognizes an entry it already extracted instead of adding
  // a second one for the same thing.
  inspectorEntryKeyLabel: 'Entry key',
  inspectorEntryKeyNone: 'Not set — AI re-runs are blocked',
  inspectorEntryKeyHint:
    'The field whose value tells one entry apart from another. Without it, running AI extraction again would add a duplicate entry instead of updating this one.',
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
  // Also the toolbar's Undo button — one key per string; the pair share
  // one slot, so they must read identically.
  undoAction: 'Undo',
  historyRedo: 'Redo',
  historyUndoEmpty: 'Nothing to undo',
  historyRedoEmpty: 'Nothing to redo',
  undoDeleteSectionToast: 'Deleted {{section}}',
  undoDeleteToast: 'Deleted {{field}}',
  undoFieldMissing: 'This field no longer exists — nothing to undo',
  undoMoveToast: 'Moved {{field}}',

  // Switch-template dialog (moved from extraction.ts, which sits at its
  // file-size ratchet ceiling; the dialog now reads ONE namespace).
  importTitle: 'Add a template',
  importDesc: 'Start from the catalogue, import a JSON file, or switch to a template this project already has.',
  importLoadingTemplates: 'Loading templates…',
  importNoTemplates: 'No global templates available at the moment.',
  importSections: 'sections',
  importTemplateSelected: 'Selected template:',
  importTemplateSelectedDetail: 'with pre-configured sections. All sections and fields will be imported to your project.',
  importImporting: 'Importing…',
  importImportButton: 'Import selected template',
  importErrorSelect: 'Select a template to import',
  importErrorImport: 'Error importing template',
  importSuccess: 'Template imported successfully',
  // Portable import/export (spec 2026-08-23).
  projectTemplatesHeading: "This project's templates",
  projectTemplatesEmpty: 'No templates yet.',
  projectTemplateActive: 'Active',
  projectTemplateCreated: 'Added {{date}}',
  projectTemplateSwitch: 'Switch to',
  projectTemplateSwitchTooltip: 'Make this the active template',
  projectTemplateDelete: 'Delete template',
  projectTemplateDeleteTitle: 'Delete "{{name}}"?',
  projectTemplateDeleteBody: 'Its sections and fields are removed. This cannot be undone.',
  projectTemplateDeleted: 'Template deleted',
  importTabCatalogue: 'Catalogue',
  importTabFile: 'Import',
  importTabProject: 'This project',
  importFromFileHeading: 'Add from a file',
  importFromFileHint: 'A .prumo-template.json file exported from prumo, or one you wrote with an AI assistant.',

  // Authoring guidance (spec 2026-08-27, slice A). ONE source of the format
  // rules: the "How to build this file" accordion renders this array and
  // lib/templateImport/aiPrompt.ts embeds it, so the two cannot drift apart.
  // A backend test (test_template_portable_example_drift.py) asserts every
  // field type and every cap below still matches template_portable.py.
  importGuidanceTitle: 'How to build this file',
  importGuidanceRules: [
    'The file is one JSON object with prumo_template: 1, kind: "extraction", a name, and a non-empty sections array.',
    'Field types are text, number, date, select, multiselect and boolean. There is no textarea.',
    'Spell the field keys type and required. The longer field_type and is_required spellings are rejected.',
    'A section with group: true repeats. Only a top-level section may be a group, and a file may contain at most one.',
    'Sections nest only inside a group, and entry_label is only allowed on a group.',
    'Limits: 100 sections per level, 200 fields per section, 2000 fields in total.',
  ],
  importPromptIntro:
    'Produce a prumo extraction template as a single JSON document that follows these rules:',
  importPromptExampleLabel: 'A valid example:',
  importPromptOutputOnly: 'Output only the JSON document, with no commentary and no code fence.',
  importCopyPrompt: 'Copy AI prompt',
  importCopyPromptDone: 'Prompt copied. Paste it into your AI assistant.',
  importDownloadExample: 'Download example',
  importExampleFilename: 'example.prumo-template.json',
  importFromFileTrust: 'Only import templates you trust — a file can carry AI instructions.',
  importFileChoose: 'Choose file',
  importFileNone: 'No file selected',
  importFileSubmit: 'Import file',
  importFileNotJson: 'This is not a valid JSON file.',
  importFileErrorsHeading: 'The file was rejected:',
  importFileMoreIssues: '+{{n}} more',
  importFileTooLarge: 'This file is larger than 2 MB.',
  projectTemplatesRefreshFailed: 'Could not refresh the list',
  importFields: 'fields',
  exportTemplateTooltip: 'Download this template as a JSON file',
  exportDraftTitle: 'Export unpublished changes?',
  exportDraftBody: 'This file includes unpublished changes.',
  exportDraftConfirm: 'Export anyway',
  exportError: 'Could not export the template',
} as const;
