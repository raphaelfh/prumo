import {createContext, useContext, useState, type ReactNode} from 'react';
import {useStore, type StoreApi} from 'zustand';
import {createViewerStore} from './store';
import type {ViewerState} from './state';

const ViewerStoreContext = createContext<StoreApi<ViewerState> | null>(null);

export interface ViewerProviderProps {
  /**
   * Optional pre-built store. When provided, this Provider does not create
   * its own — useful when a parent wants to lift store ownership (e.g., to
   * keep state across an unmount/remount, or to imperatively control it
   * from outside the React tree).
   */
  store?: StoreApi<ViewerState>;
  /**
   * Optional initial-state overrides. Ignored when `store` is provided.
   */
  initial?: Parameters<typeof createViewerStore>[0];
  children: ReactNode;
}

export function ViewerProvider({store, initial, children}: ViewerProviderProps) {
  // useState with a lazy initializer: the store is created exactly once
  // per Provider instance and survives re-renders. Each <ViewerProvider>
  // owns its own StoreApi — isolation by construction.
  const [ownedStore] = useState(() => store ?? createViewerStore(initial));
  return (
    <ViewerStoreContext.Provider value={ownedStore}>
      {children}
    </ViewerStoreContext.Provider>
  );
}

/**
 * Subscribe to the nearest ViewerProvider's store via a selector.
 * Throws if called outside a Provider.
 */
export function useViewerStore<T>(selector: (state: ViewerState) => T): T {
  const store = useContext(ViewerStoreContext);
  if (!store) {
    throw new Error(
      'useViewerStore must be used within a ViewerProvider',
    );
  }
  return useStore(store, selector);
}

/**
 * Return the raw StoreApi for the nearest ViewerProvider's store.
 * Use sparingly — prefer `useViewerStore(selector)` for reads.
 * Throws if called outside a Provider.
 */
export function useViewerStoreApi(): StoreApi<ViewerState> {
  const store = useContext(ViewerStoreContext);
  if (!store) {
    throw new Error(
      'useViewerStoreApi must be used within a ViewerProvider',
    );
  }
  return store;
}
