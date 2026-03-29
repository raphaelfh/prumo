/**
 * Trim, drop empty entries, case-insensitive dedupe (first spelling wins) for DB/API persistence.
 */
export function normalizeArticleKeywordsForSave(keywords: string[]): string[] | null {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of keywords) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
    }
    return out.length ? out : null;
}
