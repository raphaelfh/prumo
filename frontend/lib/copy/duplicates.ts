/** Copy for duplicate review (screening workspace S2). */
export const duplicates = {
  tabDuplicates: 'Duplicates',

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
