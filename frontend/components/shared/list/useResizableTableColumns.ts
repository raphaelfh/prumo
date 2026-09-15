import {useEffect, useRef, useState} from 'react';

type WidthMap = Record<string, number>;

interface UseResizableTableColumnsParams {
    columnWidths: WidthMap;
    setColumnWidths: React.Dispatch<React.SetStateAction<WidthMap>>;
    defaultColumnWidths: WidthMap;
    storageKey: string;
    minWidth?: number;
    maxWidth?: number;
    /** Opt in to bounded persisted preferences and captured pointer gestures. */
    bounds?: Record<string, {min: number; max: number}>;
}

function readPreferences(key: string): Record<string, unknown> {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
        return stored !== null && typeof stored === 'object' && !Array.isArray(stored)
            ? stored as Record<string, unknown> : {};
    } catch {
        // Width preferences are optional when storage is unavailable or malformed.
        return {};
    }
}

function persist(key: string, widths: WidthMap) {
    try {
        if (Object.keys(widths).length) localStorage.setItem(key, JSON.stringify(widths));
        else localStorage.removeItem(key);
    } catch {
        // A storage quota/privacy failure must not prevent resizing this session.
    }
}

/** Independent column resizing; opt-in bounds never steal a neighbour's width.
 * Keep pane allocation separate from these preferences (see fitReviewColumns).
 */
export function useResizableTableColumns({
    columnWidths, setColumnWidths, defaultColumnWidths, storageKey,
    minWidth = 80, maxWidth = 600, bounds,
}: UseResizableTableColumnsParams) {
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const drag = useRef<{column: string; x: number; width: number; moved: boolean} | null>(null);
    const widthsRef = useRef(columnWidths);
    const preferences = useRef<WidthMap>({});
    const loadedKey = useRef<string | null>(null);
    useEffect(() => { widthsRef.current = columnWidths; }, [columnWidths]);

    const limits = (column: string) => bounds?.[column] ?? {min: minWidth, max: maxWidth};
    const clamp = (column: string, width: number) => {
        const {min, max} = limits(column);
        return Math.min(max, Math.max(min, Math.round(Number.isFinite(width) ? width : defaultColumnWidths[column] ?? min)));
    };

    useEffect(() => {
        if (!bounds || loadedKey.current === storageKey) return;
        loadedKey.current = storageKey;
        const stored = readPreferences(storageKey);
        const next: WidthMap = {};
        for (const column of Object.keys(defaultColumnWidths)) {
            const width = stored[column];
            if (typeof width === 'number' && Number.isFinite(width)) next[column] = clamp(column, width);
        }
        preferences.current = next;
        const initial = {...defaultColumnWidths, ...next};
        widthsRef.current = initial;
        setColumnWidths(initial);
    }, [bounds, storageKey, defaultColumnWidths, setColumnWidths, clamp]);

    /** Pointer, mouse and keyboard writes share this clamp; a drag persists once, when it ends. */
    const setWidth = (column: string, width: number, save = true) => {
        const nextWidth = clamp(column, width);
        const next = {...widthsRef.current, [column]: nextWidth};
        widthsRef.current = next;
        preferences.current = {...preferences.current, [column]: nextWidth};
        setColumnWidths(next);
        if (save) persist(storageKey, bounds ? preferences.current : next);
    };
    const startResize = (column: string, clientX: number, visibleWidth?: number) => {
        drag.current = {column, x: clientX, width: clamp(column, visibleWidth ?? widthsRef.current[column] ?? defaultColumnWidths[column] ?? minWidth), moved: false};
        setResizingColumn(column);
    };
    const moveResize = (clientX: number) => {
        const start = drag.current;
        if (!start) return;
        start.moved = true;
        setWidth(start.column, start.width + clientX - start.x, false);
    };
    const endResize = () => {
        if (drag.current?.moved) persist(storageKey, bounds ? preferences.current : widthsRef.current);
        drag.current = null;
        setResizingColumn(null);
    };

    useEffect(() => {
        if (resizingColumn === null || bounds) return;
        const onMove = (event: MouseEvent) => moveResize(event.clientX);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', endResize);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', endResize);
        };
    }, [bounds, resizingColumn, moveResize, endResize]);

    useEffect(() => {
        if (resizingColumn === null) return;
        const {cursor, userSelect} = document.body.style;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        return () => {
            document.body.style.cursor = cursor;
            document.body.style.userSelect = userSelect;
        };
    }, [resizingColumn]);

    const resetWidth = (column: string) => {
        const next = {...widthsRef.current, [column]: clamp(column, defaultColumnWidths[column] ?? minWidth)};
        delete preferences.current[column];
        widthsRef.current = next;
        setColumnWidths(next);
        persist(storageKey, bounds ? preferences.current : next);
    };
    const resetWidths = () => {
        preferences.current = {};
        const next = Object.fromEntries(Object.entries(defaultColumnWidths).map(([column, width]) => [column, clamp(column, width)]));
        widthsRef.current = next;
        setColumnWidths(next);
        persist(storageKey, {});
    };
    const getHandleProps = (column: string) => ({
        width: clamp(column, columnWidths[column] ?? defaultColumnWidths[column] ?? minWidth),
        ...limits(column),
        onResizeStart: (clientX: number, visibleWidth?: number) => startResize(column, clientX, bounds ? visibleWidth : undefined),
        onResizeMove: bounds ? moveResize : undefined,
        onResizeEnd: bounds ? endResize : undefined,
        onWidth: (width: number) => setWidth(column, width),
        onReset: () => resetWidth(column),
    });
    return {resizingColumn, startResize, getHandleProps, resetWidth, resetWidths};
}
