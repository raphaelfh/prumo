/**
 * SelectWithOther / MultiSelectWithOther take canonical `{value, label}`
 * options: they render the label and store the code.
 */
import {render as rtlRender, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {TooltipProvider} from '@/components/ui/tooltip';

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {SelectWithOther} from '@/components/ui/SelectWithOther';
import {MultiSelectWithOther} from '@/components/ui/MultiSelectWithOther';

const render = (ui: React.ReactElement) =>
  rtlRender(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

const OPTIONS = [{value: 'dev', label: 'Development only'}];

describe('SelectWithOther', () => {
  it('shows the label of the selected code', () => {
    render(<SelectWithOther options={OPTIONS} value="dev" onChange={vi.fn()} ariaLabel="Stage" />);
    expect(screen.getByRole('combobox', {name: 'Stage'})).toHaveTextContent('Development only');
    expect(screen.getByRole('combobox', {name: 'Stage'})).not.toHaveTextContent(/^dev$/);
  });

  it('stores the code when an option is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectWithOther options={OPTIONS} value={null} onChange={onChange} ariaLabel="Stage" />);
    await user.click(screen.getByRole('combobox', {name: 'Stage'}));
    await user.click(await screen.findByRole('option', {name: 'Development only'}));
    expect(onChange).toHaveBeenCalledWith('dev');
  });
});

describe('MultiSelectWithOther', () => {
  it('shows the label of a selected code', () => {
    render(
      <MultiSelectWithOther
        options={OPTIONS}
        value={['dev']}
        onChange={vi.fn()}
        showSelectedLabels
        ariaLabel="Stages"
      />,
    );
    expect(screen.getByRole('button', {name: 'Stages'})).toHaveTextContent('Development only');
  });

  it('stores the code when an option is checked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelectWithOther options={OPTIONS} value={[]} onChange={onChange} ariaLabel="Stages" />);
    await user.click(screen.getByRole('button', {name: 'Stages'}));
    await user.click(await screen.findByRole('checkbox'));
    expect(screen.getByText('Development only')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(['dev']);
  });
});
