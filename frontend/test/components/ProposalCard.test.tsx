import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {ProposalCard} from '@/components/extraction/review/ProposalCard';
import type {AISuggestion, EvidenceCitation} from '@/types/ai-extraction';

vi.mock('@/hooks/extraction/useReaderLocate', () => ({useReaderLocate: () => ({locate: vi.fn(), isAvailable: false})}));

const citation = (rank: number): EvidenceCitation => ({text: `Source passage ${rank}`, rank, blockIds: [rank], pageNumber: 1});
const proposal = (sources: number): AISuggestion => ({id: 'p', runId: 'run', value: 'Value', confidence: 0.8, status: 'pending', reasoning: '', timestamp: new Date('2026-09-01'), evidence: Array.from({length: sources}, (_, rank) => citation(rank))});

describe('ProposalCard source count', () => {
  it.each([[1, '1 source'], [3, '3 sources']])('labels %i stored source(s) as "%s"', (sources, label) => {
    render(<ProposalCard proposal={proposal(sources)} ordinal={1} latest accepted={false} saving={false} onToggle={vi.fn()}/>);
    expect(screen.getByRole('article').querySelector('header')).toHaveTextContent(label);
    expect(screen.getByText(label, {exact: true})).toBeInTheDocument();
  });
});

describe('ProposalCard pending check', () => {
  // #925 asserted "no acceptance until confirmed" and signalled the wait with a
  // pulse. The pulse contradicted that same PR's "no control remounts or blinks"
  // goal, and waiting on a toggle whose outcome is already known read as a dead
  // click. The check is optimistic now; `AcceptCheck.test.tsx` covers the
  // automatic snap-back, which needs no rollback because the state is derived.
  it('keeps the same enabled node while pending, ignores clicks, and shows the click optimistically', async () => {
    const onToggle = vi.fn(); const user = userEvent.setup();
    const view = render(<ProposalCard proposal={proposal(1)} ordinal={1} latest accepted={false} saving pending onToggle={onToggle}/>);
    const check = screen.getByRole('button', {name: 'Unaccept extraction'});
    expect(check).not.toBeDisabled();
    expect(check).toHaveAttribute('aria-disabled', 'true');
    expect(check).toHaveAttribute('aria-busy', 'true');
    expect(check).toHaveAttribute('aria-pressed', 'true');
    await user.click(check);
    expect(onToggle).not.toHaveBeenCalled();
    view.rerender(<ProposalCard proposal={proposal(1)} ordinal={1} latest accepted saving={false} onToggle={onToggle}/>);
    const settled = screen.getByRole('button', {name: 'Unaccept extraction'});
    expect(settled).toBe(check);
    expect(settled).toHaveAttribute('aria-pressed', 'true');
    expect(settled).not.toHaveAttribute('aria-busy');
    await user.click(settled);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
