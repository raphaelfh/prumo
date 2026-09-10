/**
 * ReopenExtractionDialog: adaptive destructive-confirm copy + confirm/cancel wiring.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReopenExtractionDialog } from '@/components/extraction/dialogs/ReopenExtractionDialog';

const noop = () => {};

describe('ReopenExtractionDialog', () => {
  it('shows the discard copy + destructive confirm when resolvedCount > 0', () => {
    render(
      <ReopenExtractionDialog kind="extraction" open resolvedCount={2} onOpenChange={noop} onConfirm={noop} />,
    );
    expect(screen.getByText(/discards 2 resolved consensus/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reopen & discard/i })).toBeInTheDocument();
  });

  it('shows the clean copy + plain confirm when nothing is resolved', () => {
    render(
      <ReopenExtractionDialog kind="extraction" open resolvedCount={0} onOpenChange={noop} onConfirm={noop} />,
    );
    expect(screen.getByText(/nothing has been resolved yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reopen$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
  });

  it('speaks Assessment, not Extraction, for a quality-assessment run', () => {
    render(
      <ReopenExtractionDialog kind="qa" open resolvedCount={0} onOpenChange={noop} onConfirm={noop} />,
    );
    expect(screen.getByText(/reopen for assessment\?/i)).toBeInTheDocument();
    expect(screen.getByText(/returns the article to assessment/i)).toBeInTheDocument();
    expect(screen.queryByText(/extraction/i)).not.toBeInTheDocument();
  });

  it('fires onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ReopenExtractionDialog kind="extraction" open resolvedCount={1} onOpenChange={noop} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reopen & discard/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not fire onConfirm when cancel is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ReopenExtractionDialog kind="extraction" open resolvedCount={1} onOpenChange={noop} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
