/**
 * Pure-function coverage for the article editor's scrollspy decision. jsdom
 * implements neither IntersectionObserver geometry nor layout (see
 * frontend/test/setup.ts's no-op IntersectionObserver stub), so a
 * scroll-driven test through ArticleForm would be a false green — this
 * exercises the extracted decision logic with real numbers instead.
 */
import {describe, expect, it} from 'vitest';
import {isScrolledToBottom, resolveActiveStep} from '@/lib/articleFormScrollspy';

describe('resolveActiveStep', () => {
    it('picks the highest-ratio section when not at the bottom', () => {
        const ratios = new Map([
            ['basic', 0.1],
            ['publication', 0.6],
            ['identifiers', 0.3],
        ]);
        expect(resolveActiveStep(ratios, 'files', false)).toBe('publication');
    });

    it('returns null when nothing intersects and the container is not at the bottom', () => {
        expect(resolveActiveStep(new Map(), 'files', false)).toBeNull();
    });

    it('forces the last step at the bottom even when its ratio never wins', () => {
        // This is the reported bug: "Files" is short, so the rootMargin-narrowed
        // band never gives it the highest ratio — the previous section (here,
        // "additional") keeps winning on ratio alone.
        const ratios = new Map([
            ['additional', 0.4],
            ['files', 0.05],
        ]);
        expect(resolveActiveStep(ratios, 'files', true)).toBe('files');
    });

    it('forces the last step at the bottom even with an empty ratio map', () => {
        expect(resolveActiveStep(new Map(), 'files', true)).toBe('files');
    });
});

describe('isScrolledToBottom', () => {
    it('is false with room left to scroll', () => {
        expect(isScrolledToBottom({scrollTop: 0, scrollHeight: 1000, clientHeight: 400})).toBe(false);
    });

    it('is true exactly at the max scrollTop', () => {
        expect(isScrolledToBottom({scrollTop: 600, scrollHeight: 1000, clientHeight: 400})).toBe(true);
    });

    it('is true within the default threshold of the bottom', () => {
        expect(isScrolledToBottom({scrollTop: 597, scrollHeight: 1000, clientHeight: 400})).toBe(true);
    });

    it('is false just outside the default threshold', () => {
        expect(isScrolledToBottom({scrollTop: 590, scrollHeight: 1000, clientHeight: 400})).toBe(false);
    });
});
