import {describe, expect, it} from 'vitest';
import {createViewerStore} from '../core/store';

describe('createViewerStore', () => {
  it('returns a store with the expected initial state', () => {
    const store = createViewerStore();
    const state = store.getState();
    expect(state.source).toBeNull();
    expect(state.document).toBeNull();
    expect(state.numPages).toBe(0);
    expect(state.loadStatus).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.currentPage).toBe(1);
    expect(state.scale).toBe(1);
    expect(state.rotation).toBe(0);
    expect(state.citations.size).toBe(0);
    expect(state.activeCitationId).toBeNull();
    expect(typeof state.actions.goToPage).toBe('function');
  });

  it('returns isolated stores — mutating one does not affect another', () => {
    const a = createViewerStore();
    const b = createViewerStore();
    a.getState().actions.setScale(2);
    expect(a.getState().scale).toBe(2);
    expect(b.getState().scale).toBe(1);
  });

  it('actions namespace has a stable reference across state updates', () => {
    const store = createViewerStore();
    const actionsBefore = store.getState().actions;
    store.getState().actions.setScale(1.5);
    const actionsAfter = store.getState().actions;
    expect(actionsAfter).toBe(actionsBefore);
  });

  it('setLoadStatus transitions through all four states', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setLoadStatus('loading');
    expect(store.getState().loadStatus).toBe('loading');
    actions.setLoadStatus('ready');
    expect(store.getState().loadStatus).toBe('ready');
    const err = new Error('boom');
    actions.setLoadStatus('error', err);
    expect(store.getState().loadStatus).toBe('error');
    expect(store.getState().error).toBe(err);
  });

  it('setLoadStatus to non-error clears any prior error', () => {
    const store = createViewerStore();
    store.getState().actions.setLoadStatus('error', new Error('x'));
    store.getState().actions.setLoadStatus('loading');
    expect(store.getState().error).toBeNull();
  });

  it('goToPage clamps below 1 to 1', () => {
    const store = createViewerStore();
    store.getState().actions.goToPage(0);
    expect(store.getState().currentPage).toBe(1);
    store.getState().actions.goToPage(-5);
    expect(store.getState().currentPage).toBe(1);
  });

  it('goToPage clamps above numPages to numPages (when known)', () => {
    const store = createViewerStore();
    const stubDoc = {
      numPages: 10,
      fingerprint: 'stub',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {},
    };
    store.getState().actions.setDocument(stubDoc);
    expect(store.getState().numPages).toBe(10);
    store.getState().actions.goToPage(99);
    expect(store.getState().currentPage).toBe(10);
  });

  it('addCitation puts an entry in the citations map; removeCitation drops it', () => {
    const store = createViewerStore();
    const cite = {
      id: 'c1',
      anchor: {kind: 'text' as const, range: {page: 1, charStart: 0, charEnd: 5}},
    };
    store.getState().actions.addCitation(cite);
    expect(store.getState().citations.get('c1')).toEqual(cite);
    store.getState().actions.removeCitation('c1');
    expect(store.getState().citations.has('c1')).toBe(false);
  });

  it('clearCitations empties the map and unsets activeCitationId', () => {
    const store = createViewerStore();
    const cite = {
      id: 'c1',
      anchor: {kind: 'text' as const, range: {page: 1, charStart: 0, charEnd: 5}},
    };
    store.getState().actions.addCitation(cite);
    store.getState().actions.setActiveCitation('c1');
    store.getState().actions.clearCitations();
    expect(store.getState().citations.size).toBe(0);
    expect(store.getState().activeCitationId).toBeNull();
  });

  it('reset returns to initial state', () => {
    const store = createViewerStore();
    store.getState().actions.setScale(2);
    store.getState().actions.goToPage(5);
    store.getState().actions.reset();
    const s = store.getState();
    expect(s.scale).toBe(1);
    expect(s.currentPage).toBe(1);
    expect(s.loadStatus).toBe('idle');
  });

  it('reset calls document.destroy() if a document was loaded', () => {
    const store = createViewerStore();
    let destroyed = false;
    const stubDoc = {
      numPages: 3,
      fingerprint: 'x',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {destroyed = true;},
    };
    store.getState().actions.setDocument(stubDoc);
    store.getState().actions.reset();
    expect(destroyed).toBe(true);
    expect(store.getState().document).toBeNull();
  });

  it('accepts initial overrides', () => {
    const store = createViewerStore({scale: 1.5, currentPage: 7});
    expect(store.getState().scale).toBe(1.5);
    expect(store.getState().currentPage).toBe(7);
  });

  it('removeCitation of a non-existent id is a no-op', () => {
    const store = createViewerStore();
    expect(() => store.getState().actions.removeCitation('does-not-exist')).not.toThrow();
    expect(store.getState().citations.size).toBe(0);
  });

  it('setActiveCitation accepts an id not present in the citations map', () => {
    const store = createViewerStore();
    store.getState().actions.setActiveCitation('not-in-map');
    expect(store.getState().activeCitationId).toBe('not-in-map');
  });

  it('reset is idempotent — calling it twice does not throw', () => {
    const store = createViewerStore();
    store.getState().actions.reset();
    expect(() => store.getState().actions.reset()).not.toThrow();
    expect(store.getState().loadStatus).toBe('idle');
  });

  it('reset restores initial overrides supplied at factory time', () => {
    const store = createViewerStore({scale: 1.5, currentPage: 7});
    store.getState().actions.setScale(2);
    store.getState().actions.goToPage(3);
    store.getState().actions.reset();
    expect(store.getState().scale).toBe(1.5);
    expect(store.getState().currentPage).toBe(7);
  });
});

describe('search actions', () => {
  it('initial search state is empty with no active match', () => {
    const store = createViewerStore();
    const {search} = store.getState();
    expect(search.query).toBe('');
    expect(search.matches).toHaveLength(0);
    expect(search.activeIndex).toBe(-1);
    expect(search.searching).toBe(false);
    expect(search.options.caseSensitive).toBe(false);
    expect(search.options.wholeWords).toBe(false);
  });

  it('setSearchMatches sets matches and sets activeIndex to 0', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setSearchMatches([
      {pageNumber: 1, charStart: 0, charEnd: 4, context: 'test'},
      {pageNumber: 2, charStart: 10, charEnd: 14, context: 'test'},
    ]);
    const {search} = store.getState();
    expect(search.matches).toHaveLength(2);
    expect(search.activeIndex).toBe(0);
  });

  it('setSearchMatches with empty array resets activeIndex to -1', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setSearchMatches([
      {pageNumber: 1, charStart: 0, charEnd: 4, context: 'test'},
    ]);
    actions.setSearchMatches([]);
    expect(store.getState().search.activeIndex).toBe(-1);
  });

  it('goToNextMatch wraps around and calls goToPage', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setDocument({
      numPages: 5,
      fingerprint: 'x',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {},
    });
    actions.setSearchMatches([
      {pageNumber: 1, charStart: 0, charEnd: 4, context: 'a'},
      {pageNumber: 3, charStart: 5, charEnd: 9, context: 'b'},
    ]);
    expect(store.getState().search.activeIndex).toBe(0);
    actions.goToNextMatch();
    expect(store.getState().search.activeIndex).toBe(1);
    expect(store.getState().currentPage).toBe(3);
    // Wraps around.
    actions.goToNextMatch();
    expect(store.getState().search.activeIndex).toBe(0);
    expect(store.getState().currentPage).toBe(1);
  });

  it('goToPrevMatch wraps around', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setDocument({
      numPages: 5,
      fingerprint: 'x',
      metadata: async () => ({}),
      outline: async () => [],
      getPage: async () => {throw new Error('stub');},
      destroy: () => {},
    });
    actions.setSearchMatches([
      {pageNumber: 1, charStart: 0, charEnd: 4, context: 'a'},
      {pageNumber: 2, charStart: 5, charEnd: 9, context: 'b'},
    ]);
    // activeIndex is 0; going prev should wrap to 1.
    actions.goToPrevMatch();
    expect(store.getState().search.activeIndex).toBe(1);
    expect(store.getState().currentPage).toBe(2);
  });

  it('clearSearch resets all search state', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setSearchQuery('hello');
    actions.setSearchMatches([{pageNumber: 1, charStart: 0, charEnd: 5, context: 'hello'}]);
    actions.setSearchSearching(true);
    actions.clearSearch();
    const {search} = store.getState();
    expect(search.query).toBe('');
    expect(search.matches).toHaveLength(0);
    expect(search.activeIndex).toBe(-1);
    expect(search.searching).toBe(false);
  });

  it('reset also clears search state', () => {
    const store = createViewerStore();
    const {actions} = store.getState();
    actions.setSearchQuery('hello');
    actions.setSearchMatches([{pageNumber: 1, charStart: 0, charEnd: 5, context: 'hello'}]);
    actions.reset();
    const {search} = store.getState();
    expect(search.query).toBe('');
    expect(search.matches).toHaveLength(0);
    expect(search.activeIndex).toBe(-1);
  });
});
