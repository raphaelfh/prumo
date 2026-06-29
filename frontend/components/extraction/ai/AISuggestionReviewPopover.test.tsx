import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { AISuggestionReviewPopover } from './AISuggestionReviewPopover';
import type { AISuggestionHistoryItem } from '@/types/ai-extraction';

function v(over: Partial<AISuggestionHistoryItem>): AISuggestionHistoryItem {
  return {
    id: 'p1',
    runId: 'run-A',
    value: 'Retrospective cohort',
    confidence: 0.9,
    reasoning: '',
    status: 'pending',
    timestamp: new Date('2026-04-28T10:00:00Z'),
    evidence: [],
    ...over,
  };
}

describe('AISuggestionReviewPopover', () => {
  it('lists versions; marks the selected; Use-this-version selects by id; null → No information found', async () => {
    const history = [
      v({ id: 'p2', value: null, timestamp: new Date('2026-04-28T11:00:00Z') }),
      v({ id: 'p1', value: 'Retrospective cohort' }),
    ];
    const getHistory = vi.fn(async () => history);
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={getHistory}
        selectedProposalId="p1"
        onSelect={onSelect}
        onClear={vi.fn()}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    expect(getHistory).toHaveBeenCalledWith('i', 'f');

    // p1 is the selected version.
    await screen.findByText('reviewSelected');
    // p2 has a null value → renders the No information found card.
    expect(screen.getByText('reviewNoInformation')).toBeInTheDocument();

    // The only non-selected version (p2) exposes Use this version.
    const useBtn = screen.getByRole('button', { name: /reviewUseThisVersion/ });
    await user.click(useBtn);
    expect(onSelect).toHaveBeenCalledWith('p2', null);
  });

  it('Clear in the pinned footer calls onClear', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();

    render(
      <AISuggestionReviewPopover
        instanceId="i"
        fieldId="f"
        getHistory={async () => [v({})]}
        selectedProposalId="p1"
        onSelect={vi.fn()}
        onClear={onClear}
        trigger={<button>open</button>}
      />,
    );

    await user.click(screen.getByText('open'));
    const clearBtn = await screen.findByRole('button', { name: /reviewClear/ });
    await user.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
  });
});
