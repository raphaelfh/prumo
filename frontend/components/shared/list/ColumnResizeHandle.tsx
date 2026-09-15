import {useEffect, useRef} from 'react';
import {cn} from '@/lib/utils';

/** Arrow-key increment, in px — the same step as `PaneResizer`. */
const STEP = 16;

export interface ColumnResizeHandleProps {
    /** Accessible name — the column it resizes, not "resize handle". */
    label: string;
    width: number;
    min: number;
    max: number;
    /** Starts a mouse drag; the owning hook tracks the pointer from here. */
    onResizeStart: (clientX: number, visibleWidth?: number) => void;
    /** Opt in to captured pointer gestures instead of the legacy mouse path. */
    onResizeMove?: (clientX: number) => void;
    onResizeEnd?: () => void;
    onReset?: () => void;
    coarseTarget?: boolean;
    /** Receives the requested width; the owner clamps and persists it. */
    onWidth: (width: number) => void;
}

/**
 * The drag handle on the right edge of a resizable table header cell, and its
 * keyboard path: a focusable vertical separator that reports its width, with
 * arrows to nudge and Home/End to the clamps (the `PaneResizer` contract).
 * Spread `useResizableTableColumns().getHandleProps(columnId)` into it.
 */
export function ColumnResizeHandle({label, width, min, max, onResizeStart, onWidth,
    onResizeMove, onResizeEnd, onReset, coarseTarget = false}: ColumnResizeHandleProps) {
    const pointer = useRef<{id: number; target: HTMLDivElement} | null>(null);
    const endRef = useRef(onResizeEnd);
    useEffect(() => { endRef.current = onResizeEnd; }, [onResizeEnd]);
    useEffect(() => () => {
        const active = pointer.current;
        pointer.current = null;
        if (active) {
            if (active.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id);
            endRef.current?.();
        }
    }, []);
    const endPointer = (id: number) => {
        const active = pointer.current;
        if (!active || active.id !== id) return;
        pointer.current = null;
        if (active.target.hasPointerCapture(id)) active.target.releasePointerCapture(id);
        onResizeEnd?.();
    };
    return (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a focusable separator with a value is an ARIA widget (keyboard-operable below); jsx-a11y models every separator as static
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            aria-valuenow={width}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            onMouseDown={(event) => {
                if (onResizeMove || event.button !== 0) return;
                // Stops the drag from turning into a text selection across the table.
                event.preventDefault();
                onResizeStart(event.clientX);
            }}
            onPointerDown={(event) => {
                if (!onResizeMove || event.button !== 0 || pointer.current) return;
                event.preventDefault();
                pointer.current = {id: event.pointerId, target: event.currentTarget};
                event.currentTarget.setPointerCapture(event.pointerId);
                onResizeStart(event.clientX, width);
            }}
            onPointerMove={(event) => {
                if (pointer.current?.id === event.pointerId) onResizeMove?.(event.clientX);
            }}
            onPointerUp={(event) => endPointer(event.pointerId)}
            onPointerCancel={(event) => endPointer(event.pointerId)}
            onLostPointerCapture={(event) => endPointer(event.pointerId)}
            onDoubleClick={onReset}
            onKeyDown={(event) => {
                const step: Record<string, () => void> = {
                    ArrowLeft: () => onWidth(width - STEP),
                    ArrowRight: () => onWidth(width + STEP),
                    Home: () => onWidth(min),
                    End: () => onWidth(max),
                };
                const run = step[event.key];
                if (!run) return;
                event.preventDefault();
                run();
            }}
            // The hover / focus bar is a pseudo-element: an outline around a 4px
            // box renders as a slab and would overlap the neighbouring header.
            className={cn("absolute inset-y-0 right-0 w-1 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-transparent after:content-[''] hover:after:bg-primary/40 focus-visible:outline-hidden focus-visible:after:bg-ring", onResizeMove && "touch-none", coarseTarget && "pointer-coarse:w-6 pointer-coarse:-right-3 pointer-coarse:after:right-3")}
        />
    );
}
