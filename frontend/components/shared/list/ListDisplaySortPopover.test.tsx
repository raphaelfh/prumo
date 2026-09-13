import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {ListDisplaySortPopover, type ListDisplaySortPopoverProps} from './ListDisplaySortPopover';

const sortOptions = [{value: 'title', label: 'Title'}];

/** `displayPropertiesLabel` and `orderLabel` are now required — this simulates
 * a caller that skips them (bypassing the type check) to prove there is no
 * hardcoded English fallback left to fall through to at runtime. */
function renderWithoutLabels(overrides: Partial<ListDisplaySortPopoverProps>) {
  const props = {
    sortOptions,
    sortField: 'title',
    sortDirection: 'asc' as const,
    onSortFieldChange: vi.fn(),
    onSortDirectionChange: vi.fn(),
    columns: [{key: 'title', label: 'Title'}],
    visibleKeys: {title: true},
    onToggleColumn: vi.fn(),
    tooltipLabel: 'Display & sort',
    ariaLabel: 'Display options',
    ...overrides,
  };
   
  return render(<ListDisplaySortPopover {...(props as any)} />);
}

describe('ListDisplaySortPopover', () => {
  it('renders the caller-supplied display-properties label, not the old hardcoded default', async () => {
    const user = userEvent.setup();
    renderWithoutLabels({orderLabel: 'Order', displayPropertiesLabel: 'Custom display label'});
    await user.click(screen.getByRole('button', {name: 'Display options'}));
    expect(screen.getByText('Custom display label')).toBeInTheDocument();
    expect(screen.queryByText('Display properties')).not.toBeInTheDocument();
  });

  it('has no fallback text when a caller omits the labels entirely', async () => {
    const user = userEvent.setup();
    renderWithoutLabels({});
    await user.click(screen.getByRole('button', {name: 'Display options'}));
    expect(screen.queryByText('Ordering')).not.toBeInTheDocument();
    expect(screen.queryByText('Display properties')).not.toBeInTheDocument();
  });
});
