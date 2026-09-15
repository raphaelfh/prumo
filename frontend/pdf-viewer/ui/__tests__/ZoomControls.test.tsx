import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';
import {ZoomControls} from '../ZoomControls';

function renderControls(zoom: number) {
  const store = createViewerStore({zoom});
  render(
    <ViewerProvider store={store}>
      <ZoomControls />
    </ViewerProvider>,
  );
  return store;
}

describe('<ZoomControls>', () => {
  it('zooms in and out by one step', async () => {
    const user = userEvent.setup();
    const store = renderControls(1);
    await user.click(screen.getByLabelText('Zoom in'));
    expect(store.getState().zoom).toBe(1.25);
    await user.click(screen.getByLabelText('Zoom out'));
    expect(store.getState().zoom).toBe(1);
  });

  it('stops at the limits', () => {
    renderControls(4);
    expect(screen.getByLabelText('Zoom in')).toBeDisabled();
  });

  it('shows the zoom as a percentage', () => {
    renderControls(1.5);
    expect(screen.getByRole('button', {name: '150%'})).toBeInTheDocument();
  });
});
