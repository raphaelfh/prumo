/**
 * CriteriaPanel — the protocol criteria beside the record (spec §9, ruling 8):
 * a collapsed "Criteria (n)" disclosure when docked, an always-open rail when
 * maximized; nothing at all with no criteria.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {CriteriaPanel} from '@/components/screening/CriteriaPanel';

const CRITERIA = {
  inclusion: ['Adults', 'Sepsis'],
  exclusion: ['Not ML', 'Paediatric', 'Animal study'],
};

describe('CriteriaPanel', () => {
  it('disclosure is collapsed and counts every criterion', async () => {
    const user = userEvent.setup();
    render(<CriteriaPanel criteria={CRITERIA} variant="disclosure" />);
    const toggle = screen.getByRole('button', {name: 'Criteria (5)'});
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Include if')).toBeNull();
    expect(screen.queryByText('Adults')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', {name: 'Include if'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Exclude if'})).toBeInTheDocument();
    expect(screen.getByText('Adults')).toBeInTheDocument();
    expect(screen.getByText('Animal study')).toBeInTheDocument();
  });

  it('rail lists both groups open', () => {
    render(<CriteriaPanel criteria={CRITERIA} variant="rail" />);
    const rail = screen.getByRole('complementary', {name: 'Screening criteria'});
    expect(rail).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', {name: 'Include if'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Exclude if'})).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Adults',
      'Sepsis',
      'Not ML',
      'Paediatric',
      'Animal study',
    ]);
  });

  it.each(['rail', 'disclosure'] as const)('renders nothing with no criteria (%s)', (variant) => {
    const {container} = render(<CriteriaPanel criteria={{inclusion: [], exclusion: []}} variant={variant} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('omits the heading of an empty group', () => {
    render(<CriteriaPanel criteria={{inclusion: [], exclusion: ['Not ML']}} variant="rail" />);
    expect(screen.queryByRole('heading', {name: 'Include if'})).toBeNull();
    expect(screen.getByRole('heading', {name: 'Exclude if'})).toBeInTheDocument();
    expect(screen.getByText('Not ML')).toBeInTheDocument();
  });
});
