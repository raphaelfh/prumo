/**
 * Copy for the project's AI review question (PICOTS) editor.
 *
 * Slot LABELS deliberately do not live here. They vary by review type and use
 * each instrument's own wording, and the backend emits them into the prompt —
 * so the editor reads them from `GET /ai-context` rather than keeping a second
 * copy that could drift from what the model is actually told. Only text the
 * screen owns lives in this file.
 */
export const aiContext = {
    // Card / dialog chrome
    sectionTitle: 'Review question',
    sectionDesc:
        'What this review is asking. Sent to the AI with every extraction and quality assessment.',
    editAction: 'Edit review question',
    dialogTitle: 'Review question',
    dialogDesc:
        'Each part is optional. Anything left blank is omitted rather than sent as an empty field.',
    // The tabbed variant, when the dialog also carries a template's
    // general AI instruction.
    configDialogTitle: 'AI configuration',
    configDialogDesc: 'The context and instructions the AI receives on this project.',
    picotsScopeHint:
        'Project-wide — sent with every AI call from the next run. Blank parts are omitted.',
    save: 'Save',
    cancel: 'Cancel',
    saving: 'Saving…',
    saveSuccess: 'Review question updated',
    saveError: 'Could not save the review question',
    loadError: 'Could not load the review question',

    // The switch
    enabledLabel: 'Send to the AI',
    enabledHint: 'Turn off to withhold the review question from AI calls without deleting it.',
    disabledNotice: 'Not being sent to the AI.',

    // Preview
    previewTitle: 'What the AI is sent',
    previewEmpty: 'Nothing yet. Fill in at least one part above.',
    previewHint: 'Rendered by the server — this is the exact text prefixed to every AI call.',

    // Empty / summary states
    summaryEmpty: 'Not set. The AI is given no review question for this project.',
    filledCountFormat: '{{filled}} of {{total}} parts filled',
    managerOnly: 'Only project managers can change the review question.',

    // Config-bar chip
    chipLabel: 'Project context',
    chipTooltip:
        'The review question sent to the AI with every call. Applies to the next run.',
    chipMuted: 'off',

    // Timing needs a hint the label alone cannot carry.
    timingHint: 'Covers both the prediction moment (T0) and the prediction horizon.',
} as const;
