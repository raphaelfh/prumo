/**
 * UI copy for the PDF document switcher (MAIN + supplements). English only.
 * The legacy pdf.js toolbar/search/settings vocabulary was retired with its
 * components; only the switcher survives.
 */
export const pdf = {
    // Document switcher (MAIN + supplements)
    docSwitcherAria: 'Select document',
    docStatusReady: 'Ready',
    docStatusPending: 'Processing…',
    docStatusFailed: 'Parse failed',
    docReparse: 'Re-parse',
    docReparseQueued: 'Re-parse queued',
    docReparseError: 'Failed to queue re-parse',
    docParseErrorLabel: 'Parse error',
    docParseErrorUnknown: 'Parse failed — no error details recorded',
    docReparseConfirmTitle: 'Re-parse this document?',
    docReparseConfirmBody:
      'Re-parsing rebuilds the document text. Existing citation highlights for this file may shift and need re-checking.',
    docReparseConfirmCta: 'Re-parse',
} as const;

