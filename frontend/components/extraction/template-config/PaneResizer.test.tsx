/**
 * PaneResizer clamps. jsdom has no layout, so pointer dragging cannot be
 * exercised meaningfully here — the keyboard path runs the SAME `apply`,
 * so pinning it pins both. The clamps are the whole point of the component
 * (a pane dragged past them is the "comportamento estranho" it exists to
 * prevent), so every edge gets an assertion.
 */
import {fireEvent, render, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {PaneResizer} from './PaneResizer';

function setup(
  over: Partial<Parameters<typeof PaneResizer>[0]> = {},
): {onWidth: ReturnType<typeof vi.fn>; el: HTMLElement} {
  const onWidth = vi.fn();
  // Scoped to its own container: several tests mount two resizers to compare
  // the left- and right-pane behaviours side by side.
  const {container} = render(
    <PaneResizer
      pane="left"
      width={216}
      clamp={{min: 180, max: 340, initial: 216}}
      slack={() => 1000}
      label="Outline width"
      onWidth={onWidth}
      {...over}
    />,
  );
  return {onWidth, el: within(container).getByRole('separator')};
}

describe('PaneResizer', () => {
  it('exposes the pane width on the separator', () => {
    const {el} = setup();
    expect(el).toHaveAttribute('aria-orientation', 'vertical');
    expect(el).toHaveAttribute('aria-valuenow', '216');
    expect(el).toHaveAttribute('aria-valuemin', '180');
    expect(el).toHaveAttribute('aria-valuemax', '340');
    expect(el).toHaveAccessibleName('Outline width');
  });

  it('arrow keys move the DIVIDER, so the same key grows a left pane and shrinks a right one', () => {
    const left = setup();
    fireEvent.keyDown(left.el, {key: 'ArrowRight'});
    expect(left.onWidth).toHaveBeenCalledWith(232);

    const right = setup({pane: 'right'});
    fireEvent.keyDown(right.el, {key: 'ArrowRight'});
    expect(right.onWidth).toHaveBeenCalledWith(200);
  });

  it('clamps to min and max, and Home/End jump straight to them', () => {
    const atMin = setup({width: 180});
    fireEvent.keyDown(atMin.el, {key: 'ArrowLeft'});
    expect(atMin.onWidth).toHaveBeenCalledWith(180);

    const atMax = setup({width: 340});
    fireEvent.keyDown(atMax.el, {key: 'ArrowRight'});
    expect(atMax.onWidth).toHaveBeenCalledWith(340);

    const ends = setup();
    fireEvent.keyDown(ends.el, {key: 'End'});
    expect(ends.onWidth).toHaveBeenCalledWith(340);
    fireEvent.keyDown(ends.el, {key: 'Home'});
    expect(ends.onWidth).toHaveBeenCalledWith(180);
  });

  it('stops growing at the live slack — the middle pane keeps its floor', () => {
    const {onWidth, el} = setup({slack: () => 4});
    fireEvent.keyDown(el, {key: 'ArrowRight'}); // wants +16, only 4 available
    expect(onWidth).toHaveBeenCalledWith(220);
  });

  it('never yanks the pane backwards when the slack is already negative', () => {
    // A container narrowed past the floor: growing is refused, but the pane
    // must not jump to its minimum either.
    const {onWidth, el} = setup({slack: () => -120});
    fireEvent.keyDown(el, {key: 'ArrowRight'});
    expect(onWidth).toHaveBeenCalledWith(216);
  });

  it('shrinks freely even with no slack left', () => {
    const {onWidth, el} = setup({slack: () => -120});
    fireEvent.keyDown(el, {key: 'ArrowLeft'});
    expect(onWidth).toHaveBeenCalledWith(200);
  });

  it('double-click restores the default width', () => {
    const {onWidth, el} = setup({width: 330});
    fireEvent.doubleClick(el);
    expect(onWidth).toHaveBeenCalledWith(216);
  });

  it('ignores keys it does not own', () => {
    const {onWidth, el} = setup();
    fireEvent.keyDown(el, {key: 'ArrowUp'});
    fireEvent.keyDown(el, {key: 'a'});
    expect(onWidth).not.toHaveBeenCalled();
  });
});
