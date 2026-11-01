/**
 * ShortcutsHelp — the `?` popover listing every screening key (spec §4.5,
 * ruling 7): opened from its toolbar button or `?`, inert while typing or
 * under another dialog, closed by Escape.
 */
import {fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ShortcutsHelp} from '@/components/screening/ShortcutsHelp';

// Spec §4.5, in table order: the chips of each row, then its description.
const ROWS: [string[], string][] = [
  [['J', 'K', '↓', '↑'], 'Move between records'],
  [['Enter'], 'Open the record'],
  [['Esc'], 'Close, one layer at a time'],
  [['X', '⇧-click', '⌘A'], 'Select a row · a range · all'],
  [['⇧⌘\\'], 'Maximize the panel'],
  [['⌘⇧B'], 'Show or hide the panel'],
  [['1', '2', '3'], 'Include · Exclude · Maybe'],
  [['E', '1–9'], 'Exclude with a reason'],
  [['⌘F'], 'Search'],
  [['F'], 'Filter'],
  [['?'], 'Show this list'],
];

const pressQuestionMark = (target: Element | Window = window) =>
  fireEvent.keyDown(target, {key: '?', code: 'Slash', shiftKey: true});

describe('ShortcutsHelp', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh)');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every key', async () => {
    const user = userEvent.setup();
    render(<ShortcutsHelp />);
    await user.click(screen.getByRole('button', {name: 'Keyboard shortcuts'}));

    const dialog = await screen.findByRole('dialog', {name: 'Keyboard shortcuts'});
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(ROWS.length);
    ROWS.forEach(([chips, description], index) => {
      const item = items[index];
      expect(within(item).getByText(description)).toBeInTheDocument();
      expect(Array.from(item.querySelectorAll('kbd'), (kbd) => kbd.textContent)).toEqual(chips);
    });
  });

  it('at full text the decide row names 1 and 2 only', async () => {
    const user = userEvent.setup();
    render(<ShortcutsHelp phase="full_text" />);
    await user.click(screen.getByRole('button', {name: 'Keyboard shortcuts'}));

    const dialog = await screen.findByRole('dialog', {name: 'Keyboard shortcuts'});
    const decide = within(dialog).getByText('Include · Exclude').closest('li');
    expect(Array.from(decide?.querySelectorAll('kbd') ?? [], (kbd) => kbd.textContent)).toEqual(['1', '2']);
    expect(within(dialog).queryByText('Include · Exclude · Maybe')).toBeNull();
  });

  it('? opens the popover', async () => {
    render(<ShortcutsHelp />);
    expect(screen.queryByRole('dialog')).toBeNull();
    pressQuestionMark();
    expect(await screen.findByRole('dialog', {name: 'Keyboard shortcuts'})).toBeInTheDocument();
  });

  it('? anchors the popover to a visible trigger', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 28, 28)] as unknown as DOMRectList);
    render(<ShortcutsHelp />);
    pressQuestionMark();
    const dialog = await screen.findByRole('dialog', {name: 'Keyboard shortcuts'});
    expect(dialog.closest('[data-radix-popper-content-wrapper]')).not.toBeNull();
  });

  it('? centers the list when the trigger has no box (maximized panel)', async () => {
    render(<ShortcutsHelp />);
    pressQuestionMark();
    const dialog = await screen.findByRole('dialog', {name: 'Keyboard shortcuts'});
    expect(dialog.closest('[data-radix-popper-content-wrapper]')).toBeNull();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(ROWS.length);
  });

  it('? is inert in a text field and under a dialog', () => {
    const {rerender} = render(
      <>
        <input aria-label="Search" />
        <ShortcutsHelp />
      </>,
    );
    const input = screen.getByRole('textbox', {name: 'Search'});
    input.focus();
    pressQuestionMark(input);
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <>
        <div role="dialog" aria-label="Other dialog" />
        <ShortcutsHelp />
      </>,
    );
    pressQuestionMark();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', {name: 'Keyboard shortcuts'})).toBeNull();
  });

  it('Escape closes it', async () => {
    const user = userEvent.setup();
    render(<ShortcutsHelp />);
    pressQuestionMark();
    await screen.findByRole('dialog', {name: 'Keyboard shortcuts'});
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
