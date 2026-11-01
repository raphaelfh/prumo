/** Copy for duplicate review (screening workspace S2). */
export const duplicates = {
  tabDuplicates: 'Duplicates',

  // Compare panel
  fieldTitle: 'Title',
  fieldAuthors: 'Authors',
  fieldYear: 'Year',
  fieldJournal: 'Journal',
  fieldDoi: 'DOI',
  fieldPmid: 'PMID',
  fieldSource: 'Source',
  fieldPdf: 'PDF',
  fieldScreening: 'Screening work',
  decisionsCount: '{{n}} decisions',
  yes: 'Yes',
  no: 'No',
  differs: 'Differs',
  keep: 'Keep',
  keepSide: 'Keep "{{title}}"',
  merge: 'Merge, keep selected',
  notDuplicates: 'Not duplicates',
  skip: 'Skip',
  undo: 'Undo',
  setAsideWarning:
    "{{removed}}'s title/abstract decisions ({{n}}) are set aside; {{kept}} will need screening",
  resolvedMerged: 'Merged by {{name}} · {{date}}',
  resolvedDistinct: 'Marked not duplicates by {{name}} · {{date}}',

  // Failures
  errHasReviewWork: 'This record already has full-text or extraction work, so keep it instead.',
  errKeptIsRemoved: 'The record you chose to keep was already removed as a duplicate.',
  errForbidden: 'Only project managers can do this',
  errGeneric: 'Something went wrong. Try again.',

  // "Enroll anyway?" prompt on the enroll buttons
  enrollAnywayTitle: 'Enroll anyway?',
  enrollAnywayBody: '{{n}} possible duplicates not reviewed. Enroll anyway?',
  enrollAnywayConfirm: 'Enroll anyway',
  reviewDuplicates: 'Review duplicates',
} as const;
