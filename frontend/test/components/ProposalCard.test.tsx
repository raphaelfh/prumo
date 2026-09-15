import {render, screen} from '@testing-library/react';
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
