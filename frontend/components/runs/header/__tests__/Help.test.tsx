import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const base = {
  kind: 'extraction' as const, stage: 'extract' as const, isRevision: false,
  isBlind: false, canReveal: false,
  progress: { completed: 0, total: 0, pct: 0 }, reviewers: { count: 0, required: 0, divergent: 0 }, transition: null,
};

describe('RunHeader.Help', () => {
  it('opens a panel listing shortcuts and glossary', async () => {
    render(<RunHeader value={base}><RunHeader.Right><RunHeader.Help /></RunHeader.Right></RunHeader>);
    await userEvent.click(screen.getByRole('button', { name: 'helpButton' }));
    expect(screen.getByText('shortcutsHeading')).toBeInTheDocument();
    expect(screen.getByText('glossaryHeading')).toBeInTheDocument();
    // All five shortcut labels and combos.
    ['shortcutPalette', 'shortcutNextPrev', 'shortcutTogglePdf', 'shortcutSidebar', 'shortcutEsc'].forEach((k) =>
      expect(screen.getByText(k)).toBeInTheDocument());
    ['⌘K', 'J / K', '\\', '⌘B', 'Esc'].forEach((combo) =>
      expect(screen.getByText(combo)).toBeInTheDocument());
    // All five glossary entries.
    ['glossaryExtract', 'glossaryConsensus', 'glossaryFinalize', 'glossaryBlind', 'glossaryDiffer'].forEach((k) =>
      expect(screen.getByText(k)).toBeInTheDocument());
  });
});
