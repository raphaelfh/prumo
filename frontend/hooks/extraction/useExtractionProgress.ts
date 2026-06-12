/**
 * Hook to compute extraction progress.
 *
 * Thin memoized wrapper over the canonical `computeRequiredFieldProgress`
 * (`frontend/lib/extraction/progress.ts`) — the single source of truth shared
 * with the article list, the extraction table and the dashboard, so the same
 * article never reports a different percentage in different views. The formula
 * (required `(instance × field)` pairs filled) lives in one place now; this
 * hook only adds memoization and a stable call-site signature.
 *
 * @hook
 */

import {
  type ProgressEntityProjection,
  type RequiredFieldProgress,
  computeRequiredFieldProgress,
} from '@/lib/extraction/progress';

export type UseExtractionProgressReturn = RequiredFieldProgress;

export function useExtractionProgress(
  values: Record<string, any>,
  entityTypes: ProgressEntityProjection[],
): UseExtractionProgressReturn {
  return computeRequiredFieldProgress(values, entityTypes);
}
