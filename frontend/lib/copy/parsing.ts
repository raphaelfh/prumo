/**
 * UI copy for parsing settings (per-project parser backend toggle). English only.
 */
export const parsing = {
    highQualityLabel: 'High-quality PDF parsing',
    highQualityHint:
        'Uses LlamaParse for high-fidelity structured PDF parsing. When off, the self-hosted parser is used.',
    highQualityNeedsKey:
        'Requires a stored LlamaCloud API key. Add one in your API keys settings.',
    parserSaved: 'Parsing settings saved.',
    parserError: 'Failed to save parsing settings.',
} as const;
