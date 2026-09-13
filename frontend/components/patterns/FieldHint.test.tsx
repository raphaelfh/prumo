import type {ReactElement} from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {TooltipProvider} from '@/components/ui/tooltip';

import {FieldHint} from './FieldHint';

const HINT = 'Shown to every reviewer on the project.';
const renderNow = (ui: ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
const trigger = () => screen.getByRole('button', {name: 'About Project name'});

describe('FieldHint', () => {
  it('is an icon-xs IconButton named after the field it explains', () => {
    renderNow(<FieldHint label="Project name" hint={HINT} />);
    expect(trigger()).toHaveClass('h-6', 'w-6');
    expect(trigger().querySelector('svg')).not.toBeNull();
  });

  it('shows the hint as its tooltip on a fine pointer', async () => {
    renderNow(<FieldHint label="Project name" hint={HINT} />);
    await userEvent.hover(trigger());
    expect(screen.getByRole('tooltip')).toHaveTextContent(HINT);
  });

  describe('on a coarse pointer', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it('opens a popover with the hint on tap, with no tooltip', async () => {
      renderNow(<FieldHint label="Project name" hint={HINT} />);
      expect(screen.queryByText(HINT)).toBeNull();
      await userEvent.click(trigger());
      expect(screen.getByRole('dialog')).toHaveTextContent(HINT);
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });
});
