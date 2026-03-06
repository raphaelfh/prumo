/**
 * UI copy for PDF viewer (toolbar, search, shortcuts). English only.
 */
export const pdf = {
    // Keyboard shortcuts
    shortcutNextPage: 'Next page',
    shortcutPrevPage: 'Previous page',
    shortcutFirstPage: 'First page',
    shortcutLastPage: 'Last page',
    shortcutZoomIn: 'Zoom in',
    shortcutZoomOut: 'Zoom out',
    shortcutResetZoom: 'Reset zoom',
    shortcutFind: 'Search in document',
    shortcutCancel: 'Cancel current action',
    shortcutPresentation: 'Presentation mode',
    shortcutPrint: 'Print',

    // MoreTools menu
    moreToolsAria: 'More options',
    moreToolsDownload: 'Download PDF',
    moreToolsPrint: 'Print',
    moreToolsProperties: 'Document properties',
    moreToolsSettings: 'Settings',
    moreToolsDownloadTitle: 'Download',
    moreToolsDownloadDesc: 'Feature coming soon.',
    moreToolsPrintTitle: 'Print',
    moreToolsPrintDesc: 'Advanced print feature coming soon.',
    moreToolsPropertiesTitle: 'Document properties',
    moreToolsPropertiesDesc: 'Metadata view coming soon.',

    // SearchPanel
    searchPlaceholder: 'Search in document…',
    searchPrevResult: 'Previous result (Shift+Enter)',
    searchNextResult: 'Next result (Enter)',
    searchAdvancedOptions: 'Advanced options',
    searchClose: 'Close (Esc)',
    searchCaseSensitive: 'Match case',
    searchWholeWords: 'Whole words',
    searchRegex: 'Regular expression',
    searchSearching: 'Searching… {{current}}/{{total}} pages',
    searchNoResults: 'No results found for "{{query}}"',
    searchResultsInPages: 'Found in {{n}} page(s)',
    searchTotalResults: 'Total: {{n}} result(s)',
    pagePrevTitle: 'Previous page (PageUp)',
    pageNextTitle: 'Next page (PageDown)',
    pageNumberAria: 'Page number',
    zoomFitWidth: 'Fit to width',
    zoomFitPage: 'Fit to page',
    zoomOptionsTitle: 'Zoom options',

    // SettingsDialog
    settingsTitle: 'PDF Viewer settings',
    settingsDesc: 'Customize your PDF viewing experience',
    settingsTabGeneral: 'General',
    settingsTabShortcuts: 'Shortcuts',
    settingsAboutTitle: 'About',
    settingsAboutVersion: 'PDF Viewer v2.0',
    settingsAboutBased: 'Based on PDF.js and React-PDF',
    settingsAboutCopyright: '© 2025 Review Hub – Systematic Review System',
    settingsShortcutsAvailable: 'Available keyboard shortcuts',
    settingsShortcutNavigatePages: 'Navigate between pages',
    settingsShortcutFirstLastPage: 'First / Last page',
    settingsShortcutZoomInOut: 'Zoom in / out',
    settingsShortcutResetZoom: 'Reset zoom',
    settingsShortcutFind: 'Search in document',
    settingsShortcutCloseDialogs: 'Close dialogs',
    settingsTipShortcutBefore: 'Tip: Press ',
    settingsTipShortcutAfter: ' to view this list',

    // PageThumbnails
    thumbnailsNoPages: 'No pages available',
    thumbnailsPagesTitle: 'Pages ({{n}})',
    thumbnailsPageLabel: 'Page {{n}}',
    thumbnailsCurrentPage: 'Current page',
} as const;

export type PdfCopy = typeof pdf;
