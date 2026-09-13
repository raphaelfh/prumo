/** Arrow-key increment, in px — the same step as `PaneResizer`. */
const STEP = 16;

export interface ColumnResizeHandleProps {
    /** Accessible name — the column it resizes, not "resize handle". */
    label: string;
    width: number;
    min: number;
    max: number;
    /** Starts a mouse drag; the owning hook tracks the pointer from here. */
    onResizeStart: (clientX: number) => void;
    /** Receives the requested width; the owner clamps and persists it. */
    onWidth: (width: number) => void;
}

/**
 * The drag handle on the right edge of a resizable table header cell, and its
 * keyboard path: a focusable vertical separator that reports its width, with
 * arrows to nudge and Home/End to the clamps (the `PaneResizer` contract).
 * Spread `useResizableTableColumns().getHandleProps(columnId)` into it.
 */
export function ColumnResizeHandle({label, width, min, max, onResizeStart, onWidth}: ColumnResizeHandleProps) {
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
                // Stops the drag from turning into a text selection across the table.
                event.preventDefault();
                onResizeStart(event.clientX);
            }}
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
            className="absolute inset-y-0 right-0 w-1 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-transparent after:content-[''] hover:after:bg-primary/40 focus-visible:outline-hidden focus-visible:after:bg-ring"
        />
    );
}
