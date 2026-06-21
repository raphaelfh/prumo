/**
 * Shared test utilities for RunHeader component tests.
 *
 * NOTE on vi.mock:
 *   `vi.mock('@/lib/copy', ...)` is hoisted to the top of each file at
 *   compile time — it cannot be shared via an import.  Every test file that
 *   needs the copy stub must declare its own:
 *
 *     vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));
 *
 *   What CAN be shared is the RunHeaderValue baseline, exported below.
 */

import type { RunHeaderValue } from '../RunHeaderContext';

/**
 * Canonical minimal `RunHeaderValue` baseline shared across header tests.
 *
 * Covers: Breadcrumb, Help, Toggles, RoleChip (all use this shape verbatim
 * or add overrides on top).  Other test files (StageRail, PrimaryAction,
 * RunHeader.test, RunHeader.shell.test) use meaningfully different shapes and
 * are left with their own inline constants.
 */
export const BASE_RUN_HEADER_VALUE: RunHeaderValue = {
  kind: 'extraction',
  stage: 'review',
  isRevision: false,
  isBlind: false,
  canReveal: false,
  progress: { completed: 0, total: 0, pct: 0 },
  reviewers: { count: 0, required: 0, divergent: 0 },
  transition: null,
};

/**
 * Factory that merges caller-supplied overrides into the canonical baseline.
 * Returns a new object so tests cannot accidentally mutate the shared constant.
 */
export function makeRunHeaderValue(overrides?: Partial<RunHeaderValue>): RunHeaderValue {
  return { ...BASE_RUN_HEADER_VALUE, ...overrides };
}
