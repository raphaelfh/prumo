import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

// cmdk scrolls the selected option into view; jsdom has no layout.
Element.prototype.scrollIntoView = vi.fn();

import {AllowedUnitsList} from './AllowedUnitsList';

describe('AllowedUnitsList suggestions popover', () => {
  /**
   * The nine COMMON_UNITS groups are ~40 rows tall. cmdk gives a Command
   * no height of its own — the scroll box is `CommandList`
   * (`max-h-[300px] overflow-y-auto`), so items rendered as direct
   * children of `Command` grow the popover to their full height and it
   * escapes the viewport instead of scrolling. This suite pins the
   * container, because nothing in jsdom can see the overflow itself.
   */
  it('renders every suggestion inside the cmdk scroll container', async () => {
    const user = userEvent.setup();
    const {container} = render(<AllowedUnitsList values={[]} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', {name: /suggestionsButton/}));

    const list = container.ownerDocument.querySelector('[cmdk-list]');
    expect(list).not.toBeNull();
    const option = await screen.findByText('mmHg');
    expect(list).toContainElement(option);
  });

  it('keeps the empty state inside the same container', async () => {
    const user = userEvent.setup();
    const {container} = render(<AllowedUnitsList values={[]} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', {name: /suggestionsButton/}));
    await user.type(screen.getByPlaceholderText('searchUnit'), 'zzzzz');

    const list = container.ownerDocument.querySelector('[cmdk-list]');
    expect(list).toContainElement(await screen.findByText('noUnitFound'));
  });

  it('marks an already-added unit in English', async () => {
    const user = userEvent.setup();
    render(<AllowedUnitsList values={['kg']} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', {name: /suggestionsButton/}));

    expect(await screen.findByText('unitAdded')).toBeInTheDocument();
  });
});
