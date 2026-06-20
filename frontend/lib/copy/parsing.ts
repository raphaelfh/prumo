/**
 * UI copy for parsing settings (per-project parser backend toggle). English only.
 */
export const parsing = {
    highQualityLabel: 'High-quality PDF parsing',
    highQualityHint:
        'Uses LlamaParse for structured PDF parsing (non-PHI projects only — the backend automatically falls back to the self-hosted parser for PHI projects).',
    highQualityNeedsKey:
        'Requires a stored LlamaCloud API key. Add one in your API keys settings.',
    parserSaved: 'Parsing settings saved.',
    parserError: 'Failed to save parsing settings.',
} as const;
