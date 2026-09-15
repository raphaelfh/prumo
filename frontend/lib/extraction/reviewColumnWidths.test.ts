import {describe, expect, it} from 'vitest';
import {fitReviewColumns} from './reviewColumnWidths';

describe('fitReviewColumns', () => {
    it('fits oversized preferences while retaining readable minima', () => {
        const preferred = {question: 700, value: 700};
        const widths = fitReviewColumns(900, preferred);
        expect(widths.question + widths.value + widths.proposal).toBe(900);
        expect(widths.question).toBeGreaterThanOrEqual(160);
        expect(widths.value).toBeGreaterThanOrEqual(200);
        expect(widths.proposal).toBeGreaterThanOrEqual(220);
        expect(preferred).toEqual({question: 700, value: 700});
        expect(fitReviewColumns(1800, preferred)).toEqual({...preferred, proposal: 400});
    });
    it('replaces invalid preferences and clamps undersized preferences', () => {
        expect(fitReviewColumns(900, {question: -1, value: 0})).toEqual({question: 160, value: 200, proposal: 540});
        const widths = fitReviewColumns(900, {question: NaN, value: Infinity});
        expect(Object.values(widths).every(Number.isFinite)).toBe(true);
        expect(Object.values(widths).reduce((a, b) => a + b)).toBe(900);
    });
    it('uses responsive proportions below the resize breakpoint', () => {
        expect(fitReviewColumns(600, {question: 700, value: 700})).toEqual({question: 180, value: 210, proposal: 210});
    });
});
