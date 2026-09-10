/**
 * UI copy for the PDF viewer toolbar and its document switcher
 * (MAIN + supplements). English only.
 */
export const pdf = {
    // Viewer toolbar
    viewerReaderToggle: 'Parsed text view',
    viewerReaderShow: 'Show parsed text',
    viewerReaderShowHint: 'Read this file as the Markdown text parsed from it.',
    viewerReaderHide: 'Show original file',
    viewerReaderHideHint: 'Return to the original PDF pages.',
    viewerPrevPage: 'Previous page',
    viewerNextPage: 'Next page',
    viewerCurrentPage: 'Current page',
    viewerZoomOut: 'Zoom out',
    viewerZoomIn: 'Zoom in',
    viewerZoomLevel: 'Zoom level',
    viewerSearch: 'Search in document',
    viewerSearchHint: '⌘F / Ctrl+F',
    readerEmpty:
      'The parsed text is not ready yet. Parsing usually finishes shortly after upload — try again in a minute, or switch back to the original file.',
    readerLoading: 'Loading parsed text…',

    // Document switcher (MAIN + supplements)
    docSwitcherAria: 'Select document',
    docStatusReady: 'Parsed text ready',
    docStatusPending: 'Processing…',
    docStatusFailed: 'Parse failed',
    docReparse: 'Re-parse',
    docReparseHint: 'Re-parse rebuilds the parsed text from the original file.',
    docReparsePendingHint: 'The parsed text is being built. Click to retry if it looks stuck.',
    docReparseRetryHint: 'Click to retry.',
    docReparseQueued: 'Re-parse queued',
    docReparseError: 'Failed to queue re-parse',
    docParseErrorLabel: 'Parse error',
    docParseErrorUnknown: 'Parse failed — no error details recorded',
    docReparseConfirmTitle: 'Re-parse this document?',
    docReparseConfirmBody:
      'Re-parsing rebuilds the document text. Existing citation highlights for this file may shift and need re-checking.',
    docReparseConfirmCta: 'Re-parse',
} as const;

