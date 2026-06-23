/**
 * Regression (post-merge review 2026-06-21): useCitationHighlight must degrade
 * to a safe no-op when rendered OUTSIDE a ViewerProvider — the QA "jump to
 * source" / AI suggestion-details modal mounts it with no PDF viewer present.
 *
 * It previously crashed with "useViewerStore must be used within a
 * ViewerProvider" because the inner usePageHandle hook subscribed via the
 * throwing useViewerStore during render, before the storeApi==null guard.
 *
 * This file deliberately does NOT mock usePageHandle — it exercises the REAL
 * hook chain, so the no-op contract is actually verified. The sibling
 * useCitationHighlight.test.ts mocks usePageHandle away and therefore could
 * never observe this crash.
 */
import {renderHook, act} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import type {CitationAnchor} from '@/pdf-viewer/core/citation';

import {useCitationHighlight} from '../useCitationHighlight';

const REGION_ANCHOR: CitationAnchor = {
  kind: 'region',
  page: 2,
  rect: {x: 10, y: 10, width: 100, height: 20},
};

describe('useCitationHighlight without a ViewerProvider', () => {
  it('mounts without throwing and reports isAvailable=false', () => {
    const {result} = renderHook(() => useCitationHighlight());
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.activeHighlight).toBeNull();
  });

  it('highlight() and clear() are safe no-ops', () => {
    const {result} = renderHook(() => useCitationHighlight());
    expect(() => {
      act(() => {
        result.current.highlight(REGION_ANCHOR);
        result.current.clear();
      });
    }).not.toThrow();
    expect(result.current.activeHighlight).toBeNull();
  });
});
