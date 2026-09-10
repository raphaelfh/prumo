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
