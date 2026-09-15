import {act, renderHook} from '@testing-library/react';
import {useState} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

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

    it('hands a keyboard handle the width and clamps, and clamps + persists what it sets', () => {
        const {result} = renderHook(() => useHarness());

        const props = result.current.getHandleProps('year');
        expect(props).toMatchObject({width: 100, min: 80, max: 600});

        // No mouseup follows a keypress, so the write must persist on its own.
        act(() => {
            props.onWidth(1000);
        });

        expect(result.current.columnWidths.year).toBe(600);
        expect(result.current.columnWidths.title).toBe(320);
        expect(result.current.getHandleProps('year').width).toBe(600);
        expect(JSON.parse(localStorage.getItem('test-resize-widths') ?? '{}').year).toBe(600);

        act(() => {
            result.current.getHandleProps('year').onWidth(10);
        });
        expect(result.current.columnWidths.year).toBe(80);
    });

    it('writes storage once when a drag ends, not on every mousemove', () => {
        const write = vi.spyOn(localStorage, 'setItem');
        const {result} = renderHook(() => useHarness());

        act(() => {
            result.current.startResize('year', 100);
        });
        drag(110);
        drag(120);
        drag(140);
        expect(result.current.columnWidths.year).toBe(140);
        expect(write).not.toHaveBeenCalled();

        release();
        expect(write).toHaveBeenCalledTimes(1);
        write.mockRestore();
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

function useBoundedHarness() {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({...DEFAULTS});
    const api = useResizableTableColumns({columnWidths, setColumnWidths,
        defaultColumnWidths: DEFAULTS, storageKey: 'bounded', bounds: {title: {min: 160, max: 900}}});
    return {columnWidths, ...api};
}

describe('bounded preferences', () => {
    it('loads only valid known preferences and clamps stale stored values', () => {
        localStorage.setItem('bounded', JSON.stringify({title: 2000, authors: 'bad', removed: 100}));
        const {result} = renderHook(useBoundedHarness);
        expect(result.current.columnWidths).toEqual({...DEFAULTS, title: 900});
    });
    it('shares pointer and keyboard bounds and clears individual/all preferences on reset', () => {
        const {result} = renderHook(useBoundedHarness);
        act(() => result.current.getHandleProps('title').onResizeStart(100));
        act(() => result.current.getHandleProps('title').onResizeMove?.(2000));
        act(() => result.current.getHandleProps('title').onResizeEnd?.());
        expect(result.current.columnWidths.title).toBe(900);
        act(() => result.current.getHandleProps('authors').onWidth(240));
        act(() => result.current.getHandleProps('title').onReset());
        expect(result.current.columnWidths.title).toBe(320);
        expect(JSON.parse(localStorage.getItem('bounded')!)).toEqual({authors: 240});
        act(() => result.current.resetWidths());
        expect(localStorage.getItem('bounded')).toBeNull();
        expect(result.current.columnWidths).toEqual(DEFAULTS);
    });
    it('restores preexisting document styles on cancel and unmount', () => {
        document.body.style.cursor = 'crosshair';
        document.body.style.userSelect = 'text';
        const {result, unmount} = renderHook(useBoundedHarness);
        act(() => result.current.getHandleProps('title').onResizeStart(100));
        expect(document.body.style.userSelect).toBe('none');
        act(() => result.current.getHandleProps('title').onResizeEnd?.());
        expect(document.body.style.cursor).toBe('crosshair');
        act(() => result.current.getHandleProps('title').onResizeStart(100));
        unmount();
        expect(document.body.style.userSelect).toBe('text');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
});


it('continues resizing and resetting when storage is unavailable', () => {
    const read = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const remove = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const {result} = renderHook(useBoundedHarness);
    act(() => result.current.getHandleProps('title').onWidth(500));
    expect(result.current.columnWidths.title).toBe(500);
    act(() => result.current.resetWidths());
    expect(result.current.columnWidths).toEqual(DEFAULTS);
    read.mockRestore(); write.mockRestore(); remove.mockRestore();
});

it('ignores corrupt saved JSON and isolates a changed storage key', () => {
    localStorage.setItem('first', '{bad json');
    localStorage.setItem('second', JSON.stringify({title: 420}));
    const {result, rerender} = renderHook(({storageKey}) => {
        const [columnWidths, setColumnWidths] = useState<Record<string, number>>({...DEFAULTS});
        const api = useResizableTableColumns({columnWidths, setColumnWidths, defaultColumnWidths: DEFAULTS,
            storageKey, bounds: {title: {min: 160, max: 900}}});
        return {columnWidths, ...api};
    }, {initialProps: {storageKey: 'first'}});
    expect(result.current.columnWidths).toEqual(DEFAULTS);
    act(() => result.current.getHandleProps('title').onWidth(700));
    rerender({storageKey: 'second'});
    expect(result.current.columnWidths.title).toBe(420);
    expect(JSON.parse(localStorage.getItem('first')!).title).toBe(700);
});

it('writes a bounded pointer gesture once when it ends', () => {
    const {result} = renderHook(useBoundedHarness);
    const write = vi.spyOn(localStorage, 'setItem');
    act(() => result.current.getHandleProps('title').onResizeStart(100, 320));
    act(() => result.current.getHandleProps('title').onResizeMove?.(150));
    act(() => result.current.getHandleProps('title').onResizeMove?.(200));
    expect(result.current.columnWidths.title).toBe(420);
    expect(write).not.toHaveBeenCalled();
    act(() => result.current.getHandleProps('title').onResizeEnd?.());
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('bounded')!)).toEqual({title: 420});
    write.mockRestore();
});

it('starts a drag at the fitted visible width without rewriting the preference until movement', () => {
    localStorage.setItem('bounded', JSON.stringify({title: 700}));
    const {result} = renderHook(useBoundedHarness);
    act(() => result.current.getHandleProps('title').onResizeStart(100, 400));
    expect(JSON.parse(localStorage.getItem('bounded')!).title).toBe(700);
    act(() => result.current.getHandleProps('title').onResizeMove?.(120));
    expect(result.current.columnWidths.title).toBe(420);
    act(() => result.current.getHandleProps('title').onResizeEnd?.());
});
