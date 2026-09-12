import type {ReactElement} from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {TooltipProvider} from '@/components/ui/tooltip';

import {IconButton} from './IconButton';

const Glyph = () => <svg data-testid="glyph" />;
const renderNow = (ui: ReactElement) => render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);

describe('IconButton', () => {
  it('names itself and renders its glyph', () => {
    renderNow(<IconButton label="Add author" icon={<Glyph />} onClick={vi.fn()} />);
    const button = screen.getByRole('button', {name: 'Add author'});
    expect(button).toContainElement(screen.getByTestId('glyph'));
    expect(button).toHaveAttribute('type', 'button');
  });

  it('shows the label on hover', async () => {
    renderNow(<IconButton label="Add author" icon={<Glyph />} />);
    await userEvent.hover(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Add author');
  });

  it('renders the shortcut as a chip and announces it', async () => {
    renderNow(<IconButton label="Toggle sidebar" icon={<Glyph />} shortcut={['mod', 'B']} />);
    const button = screen.getByRole('button', {name: 'Toggle sidebar'});
    // jsdom is not a Mac: `mod` is Control.
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+B');
    await userEvent.hover(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Toggle sidebar');
    expect(document.querySelector('kbd')).toHaveTextContent('CtrlB');
  });

  it('lets the tooltip differ from the accessible name and adds a hint line', async () => {
    renderNow(<IconButton label="Reader mode" tooltip="Show reader" hint="Typography view" icon={<Glyph />} />);
    await userEvent.hover(screen.getByRole('button', {name: 'Reader mode'}));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Show reader');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Typography view');
  });

  it('suppresses the tooltip with tooltip={false} but keeps the name', async () => {
    renderNow(<IconButton label="Close" tooltip={false} icon={<Glyph />} />);
    await userEvent.hover(screen.getByRole('button', {name: 'Close'}));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('still explains a disabled button on hover', async () => {
    renderNow(<IconButton label="Remove member" tooltip="The last manager cannot be removed" disabled icon={<Glyph />} />);
    const button = screen.getByRole('button', {name: 'Remove member'});
    expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('The last manager cannot be removed');
  });

  it('works as the asChild child of a Radix trigger', async () => {
    renderNow(
      <Popover>
        <PopoverTrigger asChild>
          <IconButton label="Open filters" icon={<Glyph />} />
        </PopoverTrigger>
        <PopoverContent>filter panel</PopoverContent>
      </Popover>,
    );
    const button = screen.getByRole('button', {name: 'Open filters'});
    await userEvent.click(button);
    expect(screen.getByText('filter panel')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('is a ghost button with a muted glyph by default', () => {
    renderNow(<IconButton label="More" icon={<Glyph />} />);
    const classes = screen.getByRole('button').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['text-muted-foreground', 'hover:text-foreground', 'h-7', 'w-7']));
    expect(classes).not.toContain('border');
  });
});
