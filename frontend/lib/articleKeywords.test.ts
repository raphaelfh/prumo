import {describe, expect, it} from 'vitest';
import {normalizeArticleKeywordsForSave} from './articleKeywords';

describe('normalizeArticleKeywordsForSave', () => {
    it('returns null for empty input', () => {
        expect(normalizeArticleKeywordsForSave([])).toBeNull();
        expect(normalizeArticleKeywordsForSave(['', '  '])).toBeNull();
    });

    it('trims and preserves first casing for duplicates', () => {
        expect(normalizeArticleKeywordsForSave([' Foo ', 'foo', 'Bar'])).toEqual(['Foo', 'Bar']);
    });
});
