import {act, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import * as legacyPdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
vi.mock('pdfjs-dist', () => legacyPdfjs);

import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';

const {Viewer} = await import('../../primitives/Viewer');

// jsdom's user agent is not a Mac, so `mod` is Control here.
function renderViewer() {
  const store = createViewerStore({fitWidth: false});
  render(
    <ViewerProvider store={store}>
      <button type="button">Outside the viewer</button>
      <div data-pdf-viewer-root="" data-testid="viewer-root">
        <Viewer.Body>{null}</Viewer.Body>
      </div>
    </ViewerProvider>,
  );
  return store;
}

describe('zoom shortcuts', () => {
  it('zooms in and out while the pointer is over the viewer', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByTestId('viewer-root'));
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1.25);
    await user.keyboard('{Control>}-{/Control}');
    expect(store.getState().zoom).toBe(1);
  });

  it('leaves the browser’s zoom alone while the viewer has neither pointer nor focus', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByRole('button', {name: 'Outside the viewer'}));
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1);
  });

  it('zooms while focus is inside the viewer', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    const body = screen.getByTestId('viewer-root').querySelector<HTMLElement>('[data-pdf-viewer-body]')!;
    body.tabIndex = -1;
    body.focus();
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1.25);
  });

  it('zooms on ctrl/cmd shift-plus (US ⌘⇧= keyboards)', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByTestId('viewer-root'));
    await user.keyboard('{Control>}{Shift>}+{/Shift}{/Control}');
    expect(store.getState().zoom).toBe(1.25);
  });

  it('ignores a zoom shortcut while a gesture is under way', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByTestId('viewer-root'));
    act(() => store.getState().actions.setGesturing(true));
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1);
    let event: KeyboardEvent | undefined;
    act(() => {
      event = new KeyboardEvent('keydown', {key: '=', ctrlKey: true, bubbles: true, cancelable: true});
      window.dispatchEvent(event);
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(store.getState().zoom).toBe(1);
    act(() => store.getState().actions.setGesturing(false));
    await user.keyboard('{Control>}={/Control}');
    expect(store.getState().zoom).toBe(1.25);
  });

  it('zooms on ctrl/cmd plus without shift (numpad +)', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByTestId('viewer-root'));
    let dispatched = false;
    await act(async () => {
      dispatched = window.dispatchEvent(
        new KeyboardEvent('keydown', {key: '+', ctrlKey: true, shiftKey: false, bubbles: true, cancelable: true}),
      );
    });
    expect(dispatched).toBe(false);
    expect(store.getState().zoom).toBe(1.25);
  });

  it('fits the width on ⌘/Ctrl 0', async () => {
    const user = userEvent.setup();
    const store = renderViewer();
    await user.hover(screen.getByTestId('viewer-root'));
    await user.keyboard('{Control>}0{/Control}');
    expect(store.getState().fitWidth).toBe(true);
  });
});
