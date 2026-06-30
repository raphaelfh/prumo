import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import type {ReactNode} from 'react';

import {AISuggestionEvidence} from '../AISuggestionEvidence';
import {TooltipProvider} from '@/components/ui/tooltip';
import type {EvidenceCitation} from '@/types/ai-extraction';

function Wrapper({children}: {children: ReactNode}) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const ev: EvidenceCitation[] = [
  {text: 'value only in a figure', pageNumber: 3, blockIds: [], attributionLabel: 'ungroundable', rank: 0},
];

describe('AISuggestionEvidence ungroundable', () => {
  it('renders the verify-manually badge for an ungroundable citation', () => {
    render(<AISuggestionEvidence evidence={ev} />, {wrapper: Wrapper});
    expect(screen.getByText(/verify manually/i)).toBeInTheDocument();
  });

  it('applies the cautionary amber treatment to the ungroundable badge', () => {
    render(<AISuggestionEvidence evidence={ev} />, {wrapper: Wrapper});
    // The badge must keep its amber (caution) styling — a regression that
    // drops it to a neutral/entailed look should fail here, not just slip
    // past the copy assertion above.
    expect(screen.getByText(/verify manually/i).className).toMatch(/amber/);
  });
});
