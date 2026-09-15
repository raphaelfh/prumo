import {useState} from 'react';
import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {ColumnResizeHandle} from '../ColumnResizeHandle';
import {useResizableTableColumns} from '../useResizableTableColumns';

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

it('captures the pointer, avoids mouse duplication, ends on cancel/lost capture, and resets on double click', () => {
    const start = vi.fn(), move = vi.fn(), end = vi.fn(), reset = vi.fn();
    render(<ColumnResizeHandle label="Question" width={200} min={160} max={900}
        onResizeStart={start} onResizeMove={move} onResizeEnd={end} onReset={reset} onWidth={vi.fn()} />);
    const handle = screen.getByRole('separator');
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = () => true;
    fireEvent.pointerDown(handle, {pointerId: 1, clientX: 100, button: 0});
    fireEvent.mouseDown(handle, {clientX: 100});
    expect(start).toHaveBeenCalledTimes(1);
    expect(handle.setPointerCapture).toHaveBeenCalled();
    fireEvent.pointerMove(handle, {pointerId: 1, clientX: 180});
    expect(move).toHaveBeenCalled();
    fireEvent.pointerCancel(handle, {pointerId: 1});
    fireEvent.lostPointerCapture(handle, {pointerId: 1});
    expect(end).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(handle);
    expect(reset).toHaveBeenCalledOnce();
});


function BoundedHarness() {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({question: 300});
    const {getHandleProps} = useResizableTableColumns({columnWidths, setColumnWidths,
        defaultColumnWidths: {question: 300}, storageKey: 'pointer-integration', bounds: {question: {min: 160, max: 900}}});
    return <ColumnResizeHandle label="Question" {...getHandleProps('question')} />;
}

it('routes captured movement and keyboard through the hook and releases styles on unmount', () => {
    localStorage.removeItem('pointer-integration');
    const {unmount} = render(<BoundedHarness />);
    const handle = screen.getByRole('separator');
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, {pointerId: 3, clientX: 100, button: 0});
    fireEvent.pointerMove(handle, {pointerId: 3, clientX: 300});
    expect(handle).toHaveAttribute('aria-valuenow', '500');
    fireEvent.pointerUp(handle, {pointerId: 3});
    expect(document.body.style.userSelect).toBe('');
    expect(JSON.parse(localStorage.getItem('pointer-integration')!).question).toBe(500);
    fireEvent.keyDown(handle, {key: 'Home'});
    expect(handle).toHaveAttribute('aria-valuenow', '160');
    fireEvent.keyDown(handle, {key: 'ArrowLeft'});
    expect(handle).toHaveAttribute('aria-valuenow', '160');
    fireEvent.keyDown(handle, {key: 'End'});
    expect(handle).toHaveAttribute('aria-valuenow', '900');
    fireEvent.keyDown(handle, {key: 'ArrowRight'});
    expect(handle).toHaveAttribute('aria-valuenow', '900');
    fireEvent.pointerDown(handle, {pointerId: 4, clientX: 100, button: 0});
    unmount();
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(4);
});
