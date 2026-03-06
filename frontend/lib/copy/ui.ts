/**
 * UI copy for ui primitives (placeholders, aria-labels where fixed). English only.
 */
export const ui = {
    // file-drop-zone
    fileSizeExceedsMax: '{{name}} exceeds the maximum size of {{size}}MB',
    fileTypeNotAccepted: '{{name}} is not an accepted file type',
    maxFilesReached: 'You can add at most {{count}} files',
    uploadAreaAria: 'File upload area',
    fileDropLabel: 'Drag files here',
    fileDropDescription: 'or click to select',
    fileDropMaxFiles: 'Max: {{n}} file(s) • Max size: {{size}}MB per file',
    fileDropUploading: 'Uploading files…',
    fileDropAcceptedTypes: 'Accepted types:',
    fileLabel: 'File',
    removeFileAria: 'Remove {{name}}',
    // MultiSelectWithOther
    multiSelectOtherLabel: 'Other (specify)',
    multiSelectPlaceholder: 'Select…',
    multiSelectAdd: 'Add',
    multiSelectTypeHere: 'Type here',
} as const;

export type UiCopy = typeof ui;
