import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHeader } from '@/components/runs/header';
import { Utility } from '../Utility';
import { makeRunHeaderValue } from './_headerTestUtils';

// Copy stub: t(namespace, key) -> key (same convention as the other header tests).
vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

// NotificationCenter reaches the supabase client through its export services; in
// the env-less CI test run that client throws at module load. Stub the boundary
// (it has its own test) so Utility's fold logic is what's under test here.
vi.mock('@/components/navigation/NotificationCenter', () => ({
  NotificationCenter: () => <button type="button" aria-label="notif-stub" />,
}));

// useHeaderCompact measures the nearest <header>'s width via getBoundingClientRect.
// Drive that width to exercise the wide (inline) and narrow (folded) tiers.
function setHeaderWidth(width: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width, height: 48, top: 0, bottom: 48, left: 0, right: width, x: 0, y: 0, toJSON: () => {},
  } as DOMRect);
}

function renderUtility(children?: ReactNode) {
  // RunHeader supplies the <header> ancestor that useHeaderCompact measures.
  return render(
    <RunHeader value={makeRunHeaderValue()}>
      <RunHeader.Right>
        <Utility>{children}</Utility>
      </RunHeader.Right>
    </RunHeader>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('run header Utility', () => {
  it('keeps the notification bell inline on a wide header', () => {
    setHeaderWidth(1200);
    renderUtility();
    expect(screen.getByLabelText('notif-stub')).toBeInTheDocument();
  });

  it('keeps the notification bell inline on a narrow header', () => {
    setHeaderWidth(400);
    renderUtility();
    expect(screen.getByLabelText('notif-stub')).toBeInTheDocument();
  });

  describe('wide header (room for inline icons)', () => {
    it('shows help inline, with no feedback icon beside it, and no kebab', () => {
      setHeaderWidth(1200);
      renderUtility();
      expect(screen.getByRole('button', { name: 'helpButton' })).toBeInTheDocument();
      // The bug report is not a run-header affordance; the kebab arrays below
      // pin its absence from the menu, this pins it out of the inline cluster.
      expect(screen.queryByRole('button', { name: 'sendFeedback' })).not.toBeInTheDocument();
      // No business items + everything inline => no kebab at all.
      expect(screen.queryByRole('button', { name: 'more' })).not.toBeInTheDocument();
    });

    it('still shows business items in the kebab, without folding help into it', async () => {
      setHeaderWidth(1200);
      renderUtility(<RunHeader.MenuItem onSelect={() => {}}>compareToggle</RunHeader.MenuItem>);
      // Help stays inline.
      expect(screen.getByRole('button', { name: 'helpButton' })).toBeInTheDocument();
      // Kebab holds only the business item.
      await userEvent.click(screen.getByRole('button', { name: 'more' }));
      const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
      expect(items).toEqual(['compareToggle']);
    });
  });

  describe('narrow header (folds into the kebab)', () => {
    it('hides the inline help icon and folds it into the kebab', async () => {
      setHeaderWidth(400);
      renderUtility();
      expect(screen.queryByRole('button', { name: 'helpButton' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'more' }));
      expect(screen.getByRole('menuitem', { name: 'helpButton' })).toBeInTheDocument();
    });

    it('orders business items above the folded help item', async () => {
      setHeaderWidth(400);
      renderUtility(<RunHeader.MenuItem onSelect={() => {}}>compareToggle</RunHeader.MenuItem>);
      await userEvent.click(screen.getByRole('button', { name: 'more' }));
      const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
      expect(items).toEqual(['compareToggle', 'helpButton']);
    });

    it('opens the help dialog (shortcuts + glossary) from the folded item', async () => {
      setHeaderWidth(400);
      renderUtility();
      await userEvent.click(screen.getByRole('button', { name: 'more' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'helpButton' }));
      expect(screen.getByText('shortcutsHeading')).toBeInTheDocument();
      expect(screen.getByText('glossaryHeading')).toBeInTheDocument();
    });
  });
});
