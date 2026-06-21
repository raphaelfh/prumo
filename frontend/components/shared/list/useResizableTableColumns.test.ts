import {act, renderHook} from '@testing-library/react';
import {useState} from 'react';
import {beforeEach, describe, expect, it} from 'vitest';

import {useResizableTableColumns} from '@/components/shared/list/useResizableTableColumns';

const DEFAULTS = {title: 320, authors: 150, year: 100};

beforeEach(() => {
    localStorage.clear();
});

function useHarness() {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({...DEFAULTS});
    const api = useResizableTableColumns({
        columnWidths,
        setColumnWidths,
        defaultColumnWidths: DEFAULTS,
        storageKey: 'test-resize-widths',
    });
    return {columnWidths, ...api};
}

function drag(toX: number) {
    act(() => {
        window.dispatchEvent(new MouseEvent('mousemove', {clientX: toX}));
    });
}

// Ends the gesture: detaches the hook's window listeners and persists, so each
// test is self-contained rather than leaning on global afterEach teardown.
function release() {
    act(() => {
        window.dispatchEvent(new MouseEvent('mouseup'));
    });
}

describe('useResizableTableColumns', () => {
    it('resizing one column changes ONLY that column, never a neighbour', () => {
        const {result} = renderHook(() => useHarness());

        act(() => {
            result.current.startResize('title', 100);
        });
        drag(150);

        expect(result.current.columnWidths.title).toBe(370);
        // The invariant this fix establishes: a single-column drag must never
        // move a sibling. The removed push-pull model shrank the next column.
        expect(result.current.columnWidths.authors).toBe(150);
        expect(result.current.columnWidths.year).toBe(100);

        release();
    });

    it('clamps to the minimum width when dragging left past the floor', () => {
        const {result} = renderHook(() => useHarness());

        act(() => {
            result.current.startResize('title', 500);
        });
        // 320 - 500 = -180 below the 80 floor; clamp to 80.
        drag(0);

        expect(result.current.columnWidths.title).toBe(80);
        expect(result.current.columnWidths.authors).toBe(150);

        release();
    });

    it('persists widths to localStorage on mouseup', () => {
        const {result} = renderHook(() => useHarness());

        act(() => {
            result.current.startResize('year', 100);
        });
        drag(140);
        release();

        const stored = JSON.parse(localStorage.getItem('test-resize-widths') ?? '{}');
        expect(stored.year).toBe(140);
        expect(stored.title).toBe(320);
    });
});
