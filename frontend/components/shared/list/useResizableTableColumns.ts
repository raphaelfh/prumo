import {useCallback, useEffect, useRef, useState} from 'react';

type WidthMap = Record<string, number>;

interface UseResizableTableColumnsParams {
    columnWidths: WidthMap;
    setColumnWidths: React.Dispatch<React.SetStateAction<WidthMap>>;
    defaultColumnWidths: WidthMap;
    orderedColumns: string[];
    storageKey: string;
    minWidth?: number;
    maxWidth?: number;
}

export function useResizableTableColumns({
    columnWidths,
    setColumnWidths,
    defaultColumnWidths,
    orderedColumns,
    storageKey,
    minWidth = 80,
    maxWidth = 600,
}: UseResizableTableColumnsParams) {
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);
    const [resizeAdjacentColumn, setResizeAdjacentColumn] = useState<string | null>(null);
    const [resizeAdjacentStartWidth, setResizeAdjacentStartWidth] = useState(0);
    const headerRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
    const columnWidthsRef = useRef(columnWidths);
    columnWidthsRef.current = columnWidths;

    const registerHeaderRef = useCallback((columnId: string, el: HTMLTableCellElement | null) => {
        headerRefs.current[columnId] = el;
    }, []);

    const startResize = useCallback((columnId: string, clientX: number) => {
        const isVisibleColumn = (key: string) => {
            const el = headerRefs.current[key];
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };

        const currentIndex = orderedColumns.indexOf(columnId);
        let adjacentColumn: string | null = null;
        if (currentIndex >= 0) {
            for (let i = currentIndex + 1; i < orderedColumns.length; i += 1) {
                const candidate = orderedColumns[i];
                if (isVisibleColumn(candidate)) {
                    adjacentColumn = candidate;
                    break;
                }
            }
        }

        const initialWidth = columnWidths[columnId] ?? defaultColumnWidths[columnId] ?? minWidth;
        const adjacentStartWidth = adjacentColumn
            ? (columnWidths[adjacentColumn] ?? defaultColumnWidths[adjacentColumn] ?? minWidth)
            : 0;

        setResizingColumn(columnId);
        setResizeStartX(clientX);
        setResizeStartWidth(initialWidth);
        setResizeAdjacentColumn(adjacentColumn);
        setResizeAdjacentStartWidth(adjacentStartWidth);
    }, [orderedColumns, columnWidths, defaultColumnWidths, minWidth]);

    useEffect(() => {
        if (resizingColumn === null) return;

        const onMove = (e: MouseEvent) => {
            const deltaFromStart = e.clientX - resizeStartX;
            const baseWidth = resizeStartWidth;
            const adjacentBaseWidth = resizeAdjacentStartWidth;
            const hasAdjacent = !!resizeAdjacentColumn && adjacentBaseWidth > 0;

            const minDeltaByActive = minWidth - baseWidth;
            const maxDeltaByActive = maxWidth - baseWidth;
            const minDeltaByAdjacent = hasAdjacent ? -(maxWidth - adjacentBaseWidth) : Number.NEGATIVE_INFINITY;
            const maxDeltaByAdjacent = hasAdjacent ? adjacentBaseWidth - minWidth : Number.POSITIVE_INFINITY;
            const clampedDelta = Math.min(
                Math.min(maxDeltaByActive, maxDeltaByAdjacent),
                Math.max(Math.max(minDeltaByActive, minDeltaByAdjacent), deltaFromStart)
            );

            const nextWidth = Math.min(maxWidth, Math.max(minWidth, baseWidth + clampedDelta));
            const nextAdjacentWidth = hasAdjacent
                ? Math.min(maxWidth, Math.max(minWidth, adjacentBaseWidth - clampedDelta))
                : null;

            setColumnWidths((prev) => {
                if (resizeAdjacentColumn && nextAdjacentWidth != null) {
                    return {
                        ...prev,
                        [resizingColumn]: nextWidth,
                        [resizeAdjacentColumn]: nextAdjacentWidth,
                    };
                }
                return {...prev, [resizingColumn]: nextWidth};
            });
        };

        const onUp = () => {
            try {
                localStorage.setItem(storageKey, JSON.stringify(columnWidthsRef.current));
            } catch (_) {
                // ignore persistence errors
            }

            setResizingColumn(null);
            setResizeAdjacentColumn(null);
            setResizeAdjacentStartWidth(0);
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
        resizeAdjacentColumn,
        resizeAdjacentStartWidth,
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
        registerHeaderRef,
        startResize,
    };
}
