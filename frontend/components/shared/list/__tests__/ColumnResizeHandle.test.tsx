import {useState} from 'react';
import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {ColumnResizeHandle} from '../ColumnResizeHandle';

function Harness({onWidth = vi.fn()}: {onWidth?: (width: number) => void}) {
    const [width, setWidth] = useState(200);
    return (
        <ColumnResizeHandle
            label="Resize Title column"
            width={width}
            min={80}
            max={600}
            onResizeStart={vi.fn()}
            onWidth={(next) => {
                onWidth(next);
                setWidth(next);
            }}
        />
    );
}

describe('ColumnResizeHandle', () => {
    it('is a focusable vertical separator that reports its width and clamps', () => {
        render(<Harness/>);
        const handle = screen.getByRole('separator', {name: 'Resize Title column'});

        expect(handle).toHaveAttribute('aria-orientation', 'vertical');
        expect(handle).toHaveAttribute('aria-valuenow', '200');
        expect(handle).toHaveAttribute('aria-valuemin', '80');
        expect(handle).toHaveAttribute('aria-valuemax', '600');
        expect(handle).toHaveAttribute('tabindex', '0');
    });

    it('resizes from the keyboard: arrows nudge, Home and End jump to the clamps', async () => {
        const user = userEvent.setup();
        const onWidth = vi.fn();
        render(<Harness onWidth={onWidth}/>);
        const handle = screen.getByRole('separator', {name: 'Resize Title column'});

        await user.tab();
        expect(handle).toHaveFocus();

        await user.keyboard('{ArrowRight}');
        expect(handle).toHaveAttribute('aria-valuenow', '216');
        await user.keyboard('{ArrowLeft}{ArrowLeft}');
        expect(handle).toHaveAttribute('aria-valuenow', '184');
        await user.keyboard('{Home}');
        expect(handle).toHaveAttribute('aria-valuenow', '80');
        await user.keyboard('{End}');
        expect(handle).toHaveAttribute('aria-valuenow', '600');

        expect(onWidth.mock.calls.map(([w]) => w)).toEqual([216, 200, 184, 80, 600]);
    });

    it('leaves every other key alone (Tab still moves focus, nothing resizes)', () => {
        const onWidth = vi.fn();
        render(<Harness onWidth={onWidth}/>);
        const handle = screen.getByRole('separator', {name: 'Resize Title column'});

        const notPrevented = fireEvent.keyDown(handle, {key: 'ArrowUp'});

        expect(notPrevented).toBe(true);
        expect(onWidth).not.toHaveBeenCalled();
    });
});
