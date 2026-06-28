import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {SearchBar} from '../SearchBar';
import {ViewerProvider} from '../../core/context';
import {createViewerStore} from '../../core/store';
import type {StoreApi} from 'zustand';
import type {ViewerMode, ViewerState} from '../../core/state';

function setup(mode: ViewerMode, configure?: (store: StoreApi<ViewerState>) => void) {
  const store = createViewerStore({mode});
  configure?.(store);
  render(
    <ViewerProvider store={store}>
      <SearchBar open onClose={() => {}} />
    </ViewerProvider>,
  );
  return store;
}

/** Seed a reader search with `count` matches starting at index 0. */
function withMatches(count: number) {
  return (store: StoreApi<ViewerState>) => {
    store.getState().actions.setSearchQuery('tumor');
    store.getState().actions.setReaderMatchCount(count);
  };
}

describe('<SearchBar> count wiring', () => {
  it('reflects the reader match count in its position label', () => {
    setup('reader', (store) => {
      store.getState().actions.setSearchQuery('tumor');
      store.getState().actions.setReaderMatchCount(2);
    });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Next match')).toBeEnabled();
    expect(screen.getByLabelText('Previous match')).toBeEnabled();
  });

  it('disables match navigation when there are no reader matches', () => {
    setup('reader', (store) => {
      store.getState().actions.setSearchQuery('zzz');
      store.getState().actions.setReaderMatchCount(0);
    });
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByLabelText('Next match')).toBeDisabled();
  });

  it('announces the match count in a live region for screen readers', () => {
    setup('reader', withMatches(9));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1 / 9');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});

describe('<SearchBar> editor-grade keyboard + focus', () => {
  it('F3 goes to the next match, Shift+F3 to the previous', () => {
    const store = setup('reader', withMatches(3));
    const input = screen.getByLabelText('Search query');
    fireEvent.keyDown(input, {key: 'F3'});
    expect(store.getState().search.activeIndex).toBe(1);
    fireEvent.keyDown(input, {key: 'F3', shiftKey: true});
    expect(store.getState().search.activeIndex).toBe(0);
  });

  it('Cmd/Ctrl+G goes to the next match, with Shift to the previous', () => {
    const store = setup('reader', withMatches(3));
    const input = screen.getByLabelText('Search query');
    fireEvent.keyDown(input, {key: 'g', metaKey: true});
    expect(store.getState().search.activeIndex).toBe(1);
    fireEvent.keyDown(input, {key: 'g', metaKey: true, shiftKey: true});
    expect(store.getState().search.activeIndex).toBe(0);
  });

  it('returns focus to the input after clicking a navigation chevron', () => {
    setup('reader', withMatches(3));
    const input = screen.getByLabelText('Search query');
    input.blur();
    expect(document.activeElement).not.toBe(input);
    fireEvent.click(screen.getByLabelText('Next match'));
    expect(document.activeElement).toBe(input);
  });

  it('selects existing query text when opened so it can be replaced immediately', () => {
    setup('reader', withMatches(3));
    const input = screen.getByLabelText('Search query') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('tumor'.length);
  });
});
