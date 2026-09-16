import type {ComponentProps} from 'react';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {Toolbar} from '../Toolbar';
import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';
import type {ViewerMode} from '../../core/state';

function renderToolbar(mode: ViewerMode, props: Partial<ComponentProps<typeof Toolbar>> = {}) {
  const store = createViewerStore({mode, numPages: 9});
  render(
    <ViewerProvider store={store}>
      <Toolbar onSearchToggle={() => {}} {...props} />
    </ViewerProvider>,
  );
  return store;
}

function follows(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('<Toolbar> single bar', () => {
  it('puts `leading` beside the mode toggle and `center` between page nav and zoom', () => {
    renderToolbar('canvas', {
      leading: <span data-testid="leading-slot" />,
      center: <span data-testid="center-slot" />,
    });
    const toggle = screen.getByTestId('viewer-mode-toggle');
    const leading = screen.getByTestId('leading-slot');
    const center = screen.getByTestId('center-slot');

    expect(follows(toggle, leading)).toBe(true);
    expect(follows(leading, screen.getByLabelText('Previous page'))).toBe(true);
    expect(follows(screen.getByLabelText('Next page'), center)).toBe(true);
    expect(follows(center, screen.getByLabelText('Zoom out'))).toBe(true);
  });

  it('mode toggle is a pressed switch that explains itself on hover', async () => {
    const user = userEvent.setup();
    const store = renderToolbar('canvas');
    const toggle = screen.getByTestId('viewer-mode-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.hover(toggle);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Show parsed text');

    await user.click(toggle);
    expect(store.getState().mode).toBe('reader');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('<Toolbar> zoom visibility', () => {
  it('shows zoom controls in canvas mode', () => {
    renderToolbar('canvas');
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
  });

  it('hides zoom controls in reader mode (no page surface to scale)', () => {
    renderToolbar('reader');
    expect(screen.queryByLabelText('Zoom in')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Zoom out')).not.toBeInTheDocument();
  });

  it('keeps page navigation in both modes', () => {
    renderToolbar('reader');
    expect(screen.getByLabelText('Next page')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous page')).toBeInTheDocument();
  });
});

describe('<Toolbar> ☰ menu — rotate view', () => {
  it('turns the view 90° clockwise per click', async () => {
    const user = userEvent.setup();
    const store = renderToolbar('canvas');
    await user.click(screen.getByLabelText('More options'));
    await user.click(await screen.findByRole('menuitem', {name: 'Rotate view'}));
    expect(store.getState().viewRotation).toBe(90);
  });

  it('is hidden in reader mode (no page surface to rotate)', async () => {
    const user = userEvent.setup();
    renderToolbar('reader', {
      externalLink: {label: 'Open article page', href: 'https://doi.org/10.1234/abcd'},
    });
    await user.click(screen.getByLabelText('More options'));
    expect(screen.queryByRole('menuitem', {name: 'Rotate view'})).not.toBeInTheDocument();
  });
});

describe('<Toolbar> ☰ trigger visibility', () => {
  it('shows the trigger in canvas mode with no externalLink (Rotate view lives there)', () => {
    renderToolbar('canvas');
    expect(screen.getByLabelText('More options')).toBeInTheDocument();
  });

  it('hides the trigger in reader mode with no externalLink (menu would be empty)', () => {
    renderToolbar('reader');
    expect(screen.queryByLabelText('More options')).not.toBeInTheDocument();
  });

  it('shows only Open article page in reader mode with an externalLink', async () => {
    const user = userEvent.setup();
    renderToolbar('reader', {
      externalLink: {label: 'Open article page', href: 'https://doi.org/10.1234/abcd'},
    });
    const trigger = screen.getByLabelText('More options');
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', {name: 'Open article page'})).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', {name: 'Rotate view'})).not.toBeInTheDocument();
  });
});

describe('<Toolbar> ☰ menu — open article page', () => {
  it('is absent without an externalLink', async () => {
    const user = userEvent.setup();
    renderToolbar('canvas');
    await user.click(screen.getByLabelText('More options'));
    expect(screen.queryByRole('menuitem', {name: 'Open article page'})).not.toBeInTheDocument();
  });

  it('is present with an externalLink and points at its href', async () => {
    const user = userEvent.setup();
    renderToolbar('canvas', {
      externalLink: {label: 'Open article page', href: 'https://doi.org/10.1234/abcd'},
    });
    await user.click(screen.getByLabelText('More options'));
    const item = await screen.findByRole('menuitem', {name: 'Open article page'});
    expect(item).toHaveAttribute('href', 'https://doi.org/10.1234/abcd');
  });
});
