/**
 * ListDetailSplitShell: only what is new over the Articles shell — maximize,
 * the Escape chain, the code-matched chord and the list staying mounted.
 * Layout (dock/stack, Topbar toggle, ⌘⇧B) stays asserted in
 * ArticlesSplitShell.test.tsx, which runs through this shell.
 *
 * matchMedia: frontend/test/setup.ts stubs `matches: false` for every query,
 * so each test picks desktop or narrow explicitly.
 */
import {createEvent, fireEvent, render, screen} from '@testing-library/react';
import {type ReactNode, useState} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ListDetailSplitShell, type ListDetailSplitShellProps} from '@/components/layout/ListDetailSplitShell';
import {HeaderActionsProvider, useHeaderActions} from '@/contexts/HeaderActionsContext';

function setMatches(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        }),
    });
}

/** (min-width: 1024px) matches ⇒ desktop ⇒ docked split. */
const setDesktop = () => setMatches(true);
const setNarrow = () => setMatches(false);

function HeaderActionsOutlet() {
    return <>{useHeaderActions()}</>;
}

const spy = vi.fn();
const onClearSelection = vi.fn();
const onClearChecked = vi.fn();

type HarnessProps = Partial<Omit<ListDetailSplitShellProps, 'panelOpen' | 'onPanelOpenChange'>> & {
    initialOpen?: boolean;
    initialSelection?: boolean;
    initialChecked?: number;
    sibling?: ReactNode;
};

/** Owns open state, and makes selection and checked rows clearable, as a caller would. */
function Harness({initialOpen = true, initialSelection = false, initialChecked = 0, sibling, ...rest}: HarnessProps) {
    const [open, setOpen] = useState(initialOpen);
    const [hasSelection, setHasSelection] = useState(initialSelection);
    const [checkedCount, setCheckedCount] = useState(initialChecked);
    return (
        <HeaderActionsProvider>
            <ListDetailSplitShell
                list={<input aria-label="search"/>}
                panel={<div data-testid="panel-body"><input aria-label="field"/></div>}
                panelOpen={open}
                onPanelOpenChange={(o) => {
                    spy(o);
                    setOpen(o);
                }}
                idPrefix="t-shell"
                toggleLabel="Toggle panel"
                hasSelection={hasSelection}
                onClearSelection={() => {
                    onClearSelection();
                    setHasSelection(false);
                }}
                checkedCount={checkedCount}
                onClearChecked={() => {
                    onClearChecked();
                    setCheckedCount(0);
                }}
                {...rest}
            />
            <HeaderActionsOutlet/>
            {sibling}
        </HeaderActionsProvider>
    );
}

function Counter() {
    const [n, setN] = useState(0);
    return <button type="button" onClick={() => setN(n + 1)}>{`count ${n}`}</button>;
}

const list = () => document.querySelector('[data-testid="t-shell-list"]');
const panelEl = () => document.querySelector('[data-testid="t-shell-panel"]');

const pressMaximize = () =>
    fireEvent.keyDown(window, {key: '\\', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true});
const pressToggle = () => fireEvent.keyDown(window, {key: 'B', ctrlKey: true, metaKey: true, shiftKey: true});
const pressEscape = () => fireEvent.keyDown(window, {key: 'Escape'});

beforeEach(() => {
    vi.clearAllMocks();
    setDesktop();
});

describe('ListDetailSplitShell maximize', () => {
    it('maximizes on ⇧⌘\\ and restores on the second press', () => {
        render(<Harness maximizable/>);
        const body = screen.getByTestId('panel-body');

        pressMaximize();
        expect(list()).not.toBeNull();
        expect(list()).not.toBeVisible();
        expect(panelEl()).toHaveAttribute('data-maximized', 'true');
        expect(screen.getByTestId('panel-body')).toBe(body);

        pressMaximize();
        expect(list()).toBeVisible();
        expect(panelEl()).not.toHaveAttribute('data-maximized');
        expect(screen.getByTestId('panel-body')).toBe(body);
    });

    it('keeps list state across maximize and restore', () => {
        render(<Harness maximizable list={<Counter/>}/>);
        fireEvent.click(screen.getByRole('button', {name: 'count 0'}));
        fireEvent.click(screen.getByRole('button', {name: 'count 1'}));

        pressMaximize();
        pressMaximize();
        expect(screen.getByRole('button', {name: 'count 2'})).toBeVisible();
    });

    it('matches the chord by code, as real keyboards send it', () => {
        render(<Harness maximizable/>);
        fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true});
        expect(panelEl()).toHaveAttribute('data-maximized', 'true');
    });

    it('opens and maximizes a closed panel on ⇧⌘\\', () => {
        render(<Harness maximizable initialOpen={false}/>);
        expect(panelEl()).toBeNull();

        pressMaximize();
        expect(spy).toHaveBeenCalledWith(true);
        expect(list()).not.toBeVisible();
        expect(panelEl()).toHaveAttribute('data-maximized', 'true');
    });

    it('ignores ⇧⌘\\ when not maximizable', () => {
        render(<Harness/>);
        pressMaximize();
        expect(list()).toBeVisible();
        expect(panelEl()).not.toHaveAttribute('data-maximized');
    });

    it('reopens docked after a close while maximized', () => {
        render(<Harness maximizable/>);
        pressMaximize();
        expect(list()).not.toBeVisible();

        pressToggle();
        expect(spy).toHaveBeenLastCalledWith(false);
        expect(panelEl()).toBeNull();
        pressToggle();
        expect(spy).toHaveBeenLastCalledWith(true);
        expect(list()).toBeVisible();
        expect(panelEl()).not.toHaveAttribute('data-maximized');
    });

    it('maximizes below lg too, hiding the stacked list', () => {
        setNarrow();
        render(<Harness maximizable/>);
        pressMaximize();
        expect(list()).not.toBeVisible();
        expect(panelEl()).toHaveAttribute('data-maximized', 'true');
    });
});

describe('ListDetailSplitShell Escape chain', () => {
    const chainProps = {maximizable: true, escapeCloses: true} as const;
    let bubble: ReturnType<typeof vi.fn<(e: KeyboardEvent) => void>>;

    beforeEach(() => {
        bubble = vi.fn<(e: KeyboardEvent) => void>();
    });
    afterEach(() => {
        window.removeEventListener('keydown', bubble);
    });

    it('undoes one step per press: maximize, panel, selection, checked rows', () => {
        render(<Harness {...chainProps} initialSelection initialChecked={2}/>);
        pressMaximize();
        expect(list()).not.toBeVisible();

        pressEscape();
        expect(list()).toBeVisible();
        expect(spy).not.toHaveBeenCalledWith(false);
        expect(onClearSelection).not.toHaveBeenCalled();
        expect(onClearChecked).not.toHaveBeenCalled();

        pressEscape();
        expect(spy).toHaveBeenCalledWith(false);
        expect(panelEl()).toBeNull();
        expect(onClearSelection).not.toHaveBeenCalled();
        expect(onClearChecked).not.toHaveBeenCalled();

        pressEscape();
        expect(onClearSelection).toHaveBeenCalledTimes(1);
        expect(onClearChecked).not.toHaveBeenCalled();

        pressEscape();
        expect(onClearChecked).toHaveBeenCalledTimes(1);
    });

    it('handles Escape in the capture phase, ahead of bubble-phase handlers', () => {
        // Stands in for useListKeyboardShortcuts' bubble-phase Escape.
        window.addEventListener('keydown', bubble);
        render(<Harness {...chainProps}/>);

        pressEscape();
        expect(spy).toHaveBeenCalledWith(false);
        expect(bubble).not.toHaveBeenCalled();

        pressEscape();
        expect(bubble).toHaveBeenCalledTimes(1);
    });

    it('leaves an idle Escape untouched', () => {
        render(<Harness {...chainProps} initialOpen={false}/>);
        const ev = createEvent.keyDown(window, {key: 'Escape'});
        fireEvent(window, ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it('honours an Escape something else already handled', () => {
        render(<Harness {...chainProps}/>);
        const ev = createEvent.keyDown(window, {key: 'Escape'});
        ev.preventDefault();
        fireEvent(window, ev);
        expect(spy).not.toHaveBeenCalled();
        expect(panelEl()).not.toBeNull();
    });

    it('ignores Escape in a text field', () => {
        render(<Harness {...chainProps}/>);
        fireEvent.keyDown(screen.getByLabelText('field'), {key: 'Escape'});
        expect(spy).not.toHaveBeenCalled();
        expect(panelEl()).not.toBeNull();
    });

    it('yields Escape to an open overlay', () => {
        for (const role of ['menu', 'dialog']) {
            const {unmount} = render(<Harness {...chainProps} sibling={<div role={role}/>}/>);
            const ev = createEvent.keyDown(window, {key: 'Escape'});
            fireEvent(window, ev);
            expect(spy).not.toHaveBeenCalled();
            expect(panelEl()).not.toBeNull();
            expect(ev.defaultPrevented).toBe(false);
            unmount();
        }
    });

    it('does nothing on Escape when escapeCloses is off', () => {
        render(<Harness maximizable/>);
        pressMaximize();
        pressEscape();
        expect(panelEl()).toHaveAttribute('data-maximized', 'true');
        expect(spy).not.toHaveBeenCalled();
    });
});
