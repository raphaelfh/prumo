import {useEffect, useRef, useState} from 'react';

type WidthMap = Record<string, number>;

interface UseResizableTableColumnsParams {
    columnWidths: WidthMap;
    setColumnWidths: React.Dispatch<React.SetStateAction<WidthMap>>;
    defaultColumnWidths: WidthMap;
    storageKey: string;
    minWidth?: number;
    maxWidth?: number;
}

/**
 * Drag-to-resize for `table-fixed w-max` list headers (extraction, articles,
 * and any future table of the same shape).
 *
 * Resizing only ever changes the dragged column's width. The table width is the
 * sum of its column widths (`w-max`) inside a horizontally scrollable container,
 * so the surrounding columns reflow naturally — there is no neighbour to "steal"
 * width from. An earlier version inversely resized the adjacent column, which
 * made dragging one column visibly shrink another; that push-pull model is gone.
 */
export function useResizableTableColumns({
    columnWidths,
    setColumnWidths,
    defaultColumnWidths,
    storageKey,
    minWidth = 80,
    maxWidth = 600,
}: UseResizableTableColumnsParams) {
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);
    // Latest-value mirror so the mouseup handler can persist without
    // re-subscribing; written in an effect (refs must not be written in render).
    const columnWidthsRef = useRef(columnWidths);
    useEffect(() => {
        columnWidthsRef.current = columnWidths;
    }, [columnWidths]);

    const startResize = (columnId: string, clientX: number) => {
        const initialWidth = columnWidths[columnId] ?? defaultColumnWidths[columnId] ?? minWidth;
        setResizingColumn(columnId);
        setResizeStartX(clientX);
        setResizeStartWidth(initialWidth);
    };

    useEffect(() => {
        if (resizingColumn === null) return;

        const onMove = (e: MouseEvent) => {
            const deltaFromStart = e.clientX - resizeStartX;
            const nextWidth = Math.min(maxWidth, Math.max(minWidth, resizeStartWidth + deltaFromStart));
            setColumnWidths((prev) => ({...prev, [resizingColumn]: nextWidth}));
        };

        const onUp = () => {
            try {
                localStorage.setItem(storageKey, JSON.stringify(columnWidthsRef.current));
            } catch (_) {
                // ignore persistence errors
            }

            setResizingColumn(null);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [
        maxWidth,
        minWidth,
        resizeStartWidth,
        resizeStartX,
        resizingColumn,
        setColumnWidths,
        storageKey,
    ]);

    useEffect(() => {
        if (resizingColumn) {
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
        return () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [resizingColumn]);

    return {
        resizingColumn,
        startResize,
    };
}
