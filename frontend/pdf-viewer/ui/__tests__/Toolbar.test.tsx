import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {Toolbar} from '../Toolbar';
import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';
import type {ViewerMode} from '../../core/state';

function renderToolbar(mode: ViewerMode) {
  const store = createViewerStore({mode, numPages: 9});
  return render(
    <ViewerProvider store={store}>
      <Toolbar onSearchToggle={() => {}} />
    </ViewerProvider>,
  );
}

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
