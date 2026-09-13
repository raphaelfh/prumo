/**
 * Regression net for the copy-to-clipboard button's accessible name.
 *
 * `AISuggestionEvidence` used to drive a controlled tooltip (`showTooltip`
 * state + mouse handlers) for this button. The label switches with the
 * copied state regardless of that machinery — this pins the observable
 * behaviour before it is simplified away (Task 7, interaction-primitives).
 */

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import {AISuggestionEvidence} from './AISuggestionEvidence';
import {TooltipProvider} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import type {EvidenceCitation} from '@/types/ai-extraction';

function Wrapper({children}: {children: ReactNode}) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const singleCitation: EvidenceCitation[] = [
  {text: 'some evidence text', pageNumber: 3, blockIds: [], attributionLabel: null, rank: 0},
];

function renderEvidence() {
  render(<AISuggestionEvidence evidence={singleCitation} />, {wrapper: Wrapper});
}

describe('AISuggestionEvidence copy button', () => {
  it('names the copy button by its state', async () => {
    Object.assign(navigator, {clipboard: {writeText: vi.fn().mockResolvedValue(undefined)}});
    const user = userEvent.setup();
    renderEvidence();
    const button = screen.getByRole('button', {name: t('extraction', 'copySnippet')});
    await user.click(button);
    expect(await screen.findByRole('button', {name: t('extraction', 'copyCopied')})).toBeInTheDocument();
  });
});
