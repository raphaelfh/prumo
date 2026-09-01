import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';
import {stubStructuralHistory} from '@/test/helpers/structuralHistoryStub';

import {TemplateConfigToolbar} from './TemplateConfigToolbar';
import type {StructuralHistory} from './useStructuralHistory';

function renderToolbar(history: StructuralHistory) {
  return render(
    <TooltipProvider>
      <TemplateConfigToolbar
        query=""
        onQueryChange={vi.fn()}
        history={history}
        matchCount={null}
        totalCount={12}
        showKeyColumn={false}
        onShowKeyColumn={vi.fn()}
        showOptionsColumn={false}
        onShowOptionsColumn={vi.fn()}
        railPressed
        onToggleRail={vi.fn()}
        inspectorPressed={false}
        onToggleInspector={vi.fn()}
      />
    </TooltipProvider>,
  );
}

const armed = (label: string) => ({label, apply: vi.fn(async () => null)});

describe('TemplateConfigToolbar — Undo/Redo', () => {
  it('sits immediately right of the search box', () => {
    const {container} = renderToolbar(stubStructuralHistory());

    // DOM order is the reading order of the bar: the search box, then the
    // pair, then whatever the filter state adds after them.
    const controls = Array.from(container.querySelectorAll('input, button'));
    const search = controls.indexOf(container.querySelector('input')!);

    expect(controls[search + 1]?.getAttribute('aria-label')).toBe('Undo');
    expect(controls[search + 2]?.getAttribute('aria-label')).toBe('Redo');
  });

  it('disables both legs while the slot is empty', () => {
    renderToolbar(stubStructuralHistory());

    expect(screen.getByRole('button', {name: 'Undo'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Redo'})).toBeDisabled();
  });

  it('arms only the side that holds a step', () => {
    renderToolbar(stubStructuralHistory({undoStep: armed('Deleted Sample size')}));

    expect(screen.getByRole('button', {name: 'Undo'})).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Redo'})).toBeDisabled();
  });

  it('dispatches through the shared slot, never its own writes', async () => {
    const user = userEvent.setup();
    const history = stubStructuralHistory({
      undoStep: armed('Deleted Sample size'),
      redoStep: armed('Deleted Sample size'),
    });
    renderToolbar(history);

    await user.click(screen.getByRole('button', {name: 'Undo'}));
    await user.click(screen.getByRole('button', {name: 'Redo'}));

    expect(history.undo).toHaveBeenCalledTimes(1);
    expect(history.redo).toHaveBeenCalledTimes(1);
  });

  it('stands both legs down while a dispatch is in flight', () => {
    renderToolbar(
      stubStructuralHistory({
        busy: true,
        undoStep: armed('Moved Sample size'),
        redoStep: armed('Moved Sample size'),
      }),
    );

    expect(screen.getByRole('button', {name: 'Undo'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Redo'})).toBeDisabled();
  });

  it('names the pending edit on hover', async () => {
    const user = userEvent.setup();
    renderToolbar(stubStructuralHistory({undoStep: armed('Deleted Sample size')}));

    await user.hover(screen.getByRole('button', {name: 'Undo'}));

    expect(
      await screen.findByText('Undo — Deleted Sample size'),
    ).toBeInTheDocument();
  });

  it('explains itself while disabled, instead of going silent', async () => {
    const user = userEvent.setup();
    renderToolbar(stubStructuralHistory());

    // The trigger wraps a span precisely so a disabled button
    // (pointer-events: none) does not swallow the hover.
    await user.hover(screen.getByRole('button', {name: 'Redo'}).parentElement!);

    expect(await screen.findByText('Nothing to redo')).toBeInTheDocument();
  });
});
