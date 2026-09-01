/**
 * An inert `StructuralHistory` for suites that render the Configuration
 * grid but are not about Undo/Redo.
 *
 * `push` is a spy rather than a no-op: several of those suites assert that
 * a completed edit ARMS the slot, and a stub that swallowed the call would
 * make that assertion unwritable. The real slot is covered by
 * `useStructuralHistory.test.tsx`.
 */
import {vi} from 'vitest';

import type {StructuralHistory} from '@/components/extraction/template-config/useStructuralHistory';

export function stubStructuralHistory(
  overrides: Partial<StructuralHistory> = {},
): StructuralHistory {
  return {
    undoStep: null,
    redoStep: null,
    busy: false,
    push: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  };
}
