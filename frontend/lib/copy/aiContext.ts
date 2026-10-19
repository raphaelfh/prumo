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
    sectionDesc:
        'What this review is asking. Sent to the AI with every extraction and quality assessment, together with the eligibility criteria and study designs from the project details.',
    save: 'Save',
    cancel: 'Cancel',
    saving: 'Saving…',
    saveSuccess: 'Review question updated',
    saveError: 'Could not save the review question',
    loadError: 'Could not load the review question',

    // A save refused because the protocol moved since the form was seeded.
    conflictBanner:
        'The review question changed since you opened it — another manager or an agent saved it. Reload to see it; your unsaved edits will be lost.',
    conflictReload: 'Reload',

    // The switch
    enabledLabel: 'Send to the AI',
    enabledHint: 'Turn off to withhold the review question from AI calls without deleting it.',

    // Preview
    previewTitle: 'What the AI is sent',
    previewEmpty: 'Nothing yet. Fill in at least one part above.',
    previewHint:
        'Rendered by the server from this question and the project eligibility and study designs — this is the exact text prefixed to every AI call.',

    // Empty / summary states
    managerOnly: 'Only project managers can change the review question.',

    // Timing needs a hint the label alone cannot carry.
    timingHint: 'Covers both the prediction moment (T0) and the prediction horizon.',
} as const;
