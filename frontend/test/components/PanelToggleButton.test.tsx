/**
 * PanelToggleButton is shared by the Topbar sidebar toggle, the run screens'
 * header toggles, and the articles panel — a `side` regression here breaks
 * three unrelated screens at once. This spec pins the glyph pair per `side`,
 * including the `'bottom'` case the stacked (below-lg) articles layout needs.
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {PanelToggleButton} from '@/components/layout/PanelToggleButton';

function svgClassesOf(container: HTMLElement) {
    return Array.from(container.querySelectorAll('svg')).map((svg) => svg.getAttribute('class') ?? '');
}

describe('PanelToggleButton', () => {
    it('shows the left-panel glyph pair for side="left"', () => {
        const {container} = render(
            <PanelToggleButton side="left" pressed={false} onToggle={vi.fn()} ariaLabel="Toggle sidebar"/>,
        );

        const classes = svgClassesOf(container);
        expect(classes.some((c) => c.includes('lucide-panel-left-close'))).toBe(true);
        expect(classes.some((c) => c.includes('lucide-panel-left-open'))).toBe(true);
    });

    it('shows the right-panel glyph pair for side="right"', () => {
        const {container} = render(
            <PanelToggleButton side="right" pressed={false} onToggle={vi.fn()} ariaLabel="Toggle panel"/>,
        );

        const classes = svgClassesOf(container);
        expect(classes.some((c) => c.includes('lucide-panel-right-close'))).toBe(true);
        expect(classes.some((c) => c.includes('lucide-panel-right-open'))).toBe(true);
    });

    it('shows the bottom-panel glyph pair for side="bottom" — the stacked layout opens the panel from the bottom', () => {
        const {container} = render(
            <PanelToggleButton side="bottom" pressed={false} onToggle={vi.fn()} ariaLabel="Toggle panel"/>,
        );

        const classes = svgClassesOf(container);
        expect(classes.some((c) => c.includes('lucide-panel-bottom-close'))).toBe(true);
        expect(classes.some((c) => c.includes('lucide-panel-bottom-open'))).toBe(true);
        // Never falls back to the left/right glyphs for the new side.
        expect(classes.some((c) => c.includes('lucide-panel-left'))).toBe(false);
        expect(classes.some((c) => c.includes('lucide-panel-right'))).toBe(false);
    });

    it('keeps the caller-supplied aria-label regardless of side', () => {
        render(
            <PanelToggleButton side="bottom" pressed onToggle={vi.fn()} ariaLabel="Hide the article panel"/>,
        );

        expect(screen.getByRole('button', {name: 'Hide the article panel'})).toBeInTheDocument();
    });
});
