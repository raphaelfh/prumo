/**
 * subscribeReaderLocate — invoke `onLocate` once per *new* reader-locate request.
 *
 * The store's `readerLocate` carries a monotonic `nonce`; zustand's `subscribe`
 * fires on every state change, so consumers must de-duplicate by nonce. This
 * helper centralises that bookkeeping (previously hand-rolled, subtly
 * differently, in both the Reader and ExtractionFullScreen).
 *
 * `immediate: true` also fires for a request already pending at subscription
 * time — needed by the Reader, which mounts only after the popover flips the
 * viewer to reader mode (so the request is set before it can subscribe).
 *
 * Returns the unsubscribe function.
 */
import type {StoreApi} from 'zustand';

import type {ReaderLocateRequest, ViewerState} from './state';

export function subscribeReaderLocate(
  store: StoreApi<ViewerState>,
  onLocate: (req: ReaderLocateRequest) => void,
  {immediate = false}: {immediate?: boolean} = {},
): () => void {
  const pending = store.getState().readerLocate;
  let lastNonce = pending?.nonce ?? 0;
  if (immediate && pending) onLocate(pending);

  return store.subscribe((state) => {
    const req = state.readerLocate;
    if (req && req.nonce !== lastNonce) {
      lastNonce = req.nonce;
      onLocate(req);
    }
  });
}
