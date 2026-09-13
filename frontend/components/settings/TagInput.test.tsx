import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {TagInput} from '@/components/settings';

const noop = () => {};
const BORDER = /(^|\s)border(\s|-|$)/;

describe('TagInput', () => {
  it('lets a settings row label and describe its draft input', () => {
    render(
      <>
        <label htmlFor="review_keywords">Review keywords</label>
        <span id="review_keywords-hint">Terms that describe the review</span>
        <TagInput id="review_keywords" aria-describedby="review_keywords-hint" addLabel="Add to Review keywords" items={[]} onAdd={noop} onRemove={noop} />
      </>,
    );
    const input = screen.getByRole('textbox', {name: 'Review keywords'});
    expect(input).toHaveAttribute('aria-describedby', 'review_keywords-hint');
    expect(input).toHaveAccessibleDescription('Terms that describe the review');
  });

  it('draws the draft input quiet, with no size override', () => {
    render(<TagInput addLabel="Add" items={[]} onAdd={noop} onRemove={noop} />);
    expect(screen.getByRole('textbox')).toHaveClass('border-transparent', 'h-8', 'md:text-[13px]');
    expect(screen.getByRole('textbox')).not.toHaveClass('h-7');
  });

  it.each(['badge', 'list'] as const)('names the %s add control by addLabel and adds the trimmed draft', async (variant) => {
    const onAdd = vi.fn();
    render(<TagInput variant={variant} addLabel="Add to Inclusion criteria" items={[]} onAdd={onAdd} onRemove={noop} />);
    await userEvent.type(screen.getByRole('textbox'), '  adults  ');
    await userEvent.click(screen.getByRole('button', {name: 'Add to Inclusion criteria'}));
    expect(onAdd).toHaveBeenCalledWith('adults');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('still adds on Enter and removes by index', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<TagInput addLabel="Add" items={['a', 'b']} onAdd={onAdd} onRemove={onRemove} />);
    await userEvent.type(screen.getByRole('textbox'), 'c{Enter}');
    expect(onAdd).toHaveBeenCalledWith('c');
    await userEvent.click(screen.getAllByRole('button', {name: 'Remove'})[1]);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('draws badge chips with no border', () => {
    render(<TagInput variant="badge" addLabel="Add" items={['cardiology']} onAdd={noop} onRemove={noop} />);
    const chip = screen.getByText('cardiology');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).not.toMatch(BORDER);
  });

  it.each([
    ['neutral', 'bg-muted/50'],
    ['green', 'bg-success/10'],
    ['red', 'bg-destructive/10'],
  ] as const)('tints a %s list item with %s tokens and no border', (listVariant, tint) => {
    render(<TagInput variant="list" listVariant={listVariant} addLabel="Add" items={['NYHA II-IV']} onAdd={noop} onRemove={noop} />);
    const item = screen.getByRole('listitem');
    expect(item).toHaveClass(tint);
    expect(item.className).not.toMatch(BORDER);
    expect(item.className).not.toMatch(/green-500|red-500/);
  });
});
