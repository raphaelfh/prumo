/**
 * Wiring tests for AISuggestionDetailsPopover (anchored, non-modal Popover).
 *
 * Verifies that:
 *  - rationale + evidence render when the popover is opened;
 *  - inside a ViewerProvider (isAvailable=true) the evidence shows a
 *    "Locate in document" button that calls reader-locate with the evidence
 *    text + page and then closes the popover;
 *  - outside a ViewerProvider (isAvailable=false) no locate button renders and
 *    the evidence still shows (no crash).
 *
 * Mocks: useReaderLocate (the markdown-first locate hook).
 */

import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi, beforeEach} from 'vitest';
import type {ReactNode} from 'react';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

const locateSpy = vi.fn();
const useReaderLocateMock = vi.fn(() => ({locate: locateSpy, isAvailable: true}));
vi.mock('@/hooks/extraction/useReaderLocate', () => ({
  useReaderLocate: () => useReaderLocateMock(),
}));

import {AISuggestionDetailsPopover} from './AISuggestionDetailsPopover';
import {TooltipProvider} from '@/components/ui/tooltip';

const suggestion = {
  id: 'sug-1',
  runId: 'run-1',
  value: 'some value',
  status: 'pending' as const,
  confidence: 0.9,
  reasoning: 'Because of this evidence.',
  timestamp: new Date('2024-01-01T00:00:00Z'),
  evidence: {text: 'test evidence', pageNumber: 2},
};

function Wrapper({children}: {children: ReactNode}) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

beforeEach(() => {
  locateSpy.mockClear();
  useReaderLocateMock.mockReturnValue({locate: locateSpy, isAvailable: true});
});

describe('AISuggestionDetailsPopover — reader-locate wiring', () => {
  it('opens and shows the rationale + cited evidence', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionDetailsPopover suggestion={suggestion} trigger={<button>Open</button>} />,
      {wrapper: Wrapper},
    );

    await user.click(screen.getByRole('button', {name: 'Open'}));

    expect(await screen.findByText('Because of this evidence.')).toBeInTheDocument();
    expect(screen.getByText(/test evidence/)).toBeInTheDocument();
  });

  it('locate button calls reader-locate with text + page, then closes the popover', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionDetailsPopover suggestion={suggestion} trigger={<button>Open</button>} />,
      {wrapper: Wrapper},
    );

    await user.click(screen.getByRole('button', {name: 'Open'}));
    const locateBtn = await screen.findByRole('button', {name: 'evidenceLocate'});

    await user.click(locateBtn);
    expect(locateSpy).toHaveBeenCalledOnce();
    expect(locateSpy).toHaveBeenCalledWith('test evidence', 2);

    // Popover closed → content unmounts.
    await waitFor(() => {
      expect(screen.queryByText(/test evidence/)).not.toBeInTheDocument();
    });
  });

  it('no viewer (isAvailable=false) → no locate button, evidence still shown', async () => {
    const user = userEvent.setup();
    useReaderLocateMock.mockReturnValue({locate: locateSpy, isAvailable: false});

    render(
      <AISuggestionDetailsPopover suggestion={suggestion} trigger={<button>Open</button>} />,
      {wrapper: Wrapper},
    );

    await user.click(screen.getByRole('button', {name: 'Open'}));

    expect(await screen.findByText(/test evidence/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'evidenceLocate'})).not.toBeInTheDocument();
  });
});
