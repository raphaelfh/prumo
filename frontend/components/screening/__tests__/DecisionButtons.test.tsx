/**
 * DecisionButtons: the recorded-choice ring on a solo record, re-decide with
 * another value, and the keyboard through the phase-aware keymap.
 */
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {DecisionButtons} from '@/components/screening/DecisionButtons';
import type {ScreeningDecisionCreate} from '@/services/screeningService';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

function renderButtons(recorded?: ScreeningDecisionCreate['decision'] | null) {
  const onDecide = vi.fn<(body: ScreeningDecisionCreate) => void>();
  render(
    <DecisionButtons reasons={[]} disabled={false} onDecide={onDecide} phase="title_abstract" recorded={recorded} />,
  );
  return onDecide;
}

describe('DecisionButtons', () => {
  it('draws the recorded decision with the success ring', () => {
    renderButtons('include');
    const include = screen.getByRole('button', {name: /decisionInclude/});
    expect(include).toHaveAttribute('aria-pressed', 'true');
    expect(include.className).toContain('ring-success');
    expect(screen.getByRole('button', {name: /decisionExclude/})).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', {name: /decisionMaybe/})).toHaveAttribute('aria-pressed', 'false');
  });

  it('sets no pressed state without a recorded decision', () => {
    renderButtons();
    expect(screen.getByRole('button', {name: /decisionInclude/})).not.toHaveAttribute('aria-pressed');
  });

  it('re-decides with another value', async () => {
    const user = userEvent.setup();
    const onDecide = renderButtons('include');
    await user.click(screen.getByRole('button', {name: /decisionExclude/}));
    expect(onDecide).toHaveBeenCalledWith({decision: 'exclude'});
  });

  it('ignores the recorded value', async () => {
    const user = userEvent.setup();
    const onDecide = renderButtons('include');
    await user.click(screen.getByRole('button', {name: /decisionInclude/}));
    fireEvent.keyDown(window, {key: '1'});
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('keys decide while enabled', () => {
    const onDecide = renderButtons();
    fireEvent.keyDown(window, {key: '3'});
    expect(onDecide).toHaveBeenCalledWith({decision: 'maybe'});
  });

  it('keys are inert in a text field', () => {
    const onDecide = renderButtons();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, {key: '1'});
    expect(onDecide).not.toHaveBeenCalled();
    input.remove();
  });
});
