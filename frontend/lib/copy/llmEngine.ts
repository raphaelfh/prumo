/**
 * UI copy for the per-project LLM engine chip + picker popover (§5, C1b).
 * English only.
 */
export const llmEngine = {
    chipAria: 'Extraction model',
    chipTooltip: 'Model used for AI extraction in this project',
    modeGroupAria: 'Extraction mode',
    modeFast: 'Fast',
    modeVerified: 'Verified',
    searchPlaceholder: 'Search models…',
    emptyResults: 'No models match.',
    providerOpenai: 'OpenAI',
    providerAnthropic: 'Anthropic',
    byokGroupNote: 'each user runs on their own key',
    lockedAddKeyCta: 'Add your key',
    lockedAddKeyItem: 'Add your key…',
    currentModelAria: 'Current model',
    attribution: 'Model changed by {{name}} · {{date}} · was {{model}}',
    attributionNoPrevious: 'Model changed by {{name}} · {{date}}',
    retiredNote:
        'This model is no longer in the catalogue. New extraction runs are blocked — choose a new model.',
    alternatesTitle: 'Alternate engines',
    alternatesHelper:
        "Reviewers who can't run the default may run these instead — labeled as deviations.",
    alternatesEmpty: 'None — policy locked to the default engine.',
    alternatesRemoveAria: 'Remove alternate',
    alternatesPrimaryNote: 'Current default',
    alternatesByokWarn:
        "BYOK-only — won't unblock reviewers without their own key.",
    alternatesAddLabel: 'Add alternate',
    alternatesDoneLabel: 'Done',
    alternatesSaveSuccess: 'Alternates updated.',
    alternatesSaveError: 'Failed to update alternates',
    saveSuccess: 'Extraction model updated.',
    saveError: 'Failed to update the extraction model',
} as const;
