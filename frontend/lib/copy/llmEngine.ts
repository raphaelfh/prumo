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
    saveSuccess: 'Extraction model updated.',
    saveError: 'Failed to update the extraction model',
} as const;
