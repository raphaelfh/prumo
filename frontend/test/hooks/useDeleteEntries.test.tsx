/**
 * useDeleteEntries — who may delete an entry.
 *
 * The hook owns BOTH deletes, so it owns the authority for both. That is not
 * tidiness: `extraction_instances_delete` is `USING is_project_manager(...)`,
 * and the single delete is a browser PostgREST call through
 * `baseRepository.deleteOne` — `.delete().eq('id', id)` with NO `.select()`.
 * A reviewer's DELETE matches zero rows, PostgREST reports no error, and the
 * caller announces success over an untouched entry. A UI that offers that
 * control is worse than one that 403s.
 *
 * Gating at the hook rather than at each call site is what makes the three
 * affordances (selector trash, card-list inline remove, bulk Select) impossible
 * to gate individually and forget one — which is exactly what happened.
 */
import {renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

// Same CI trap as useAddEntry.test: with no VITE_ env, importing the api
// client at module load calls `createClient('')` and throws.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: null}})}},
}));
vi.mock('@/integrations/api/client', () => ({deleteEntries: vi.fn()}));
vi.mock('@/services/extractionInstanceService', () => ({
  extractionInstanceService: {removeInstance: vi.fn()},
}));
vi.mock('sonner', () => ({toast: {error: vi.fn(), success: vi.fn()}}));

import {useDeleteEntries} from '@/hooks/extraction/useDeleteEntries';

const args = (canDelete: boolean) => ({
  projectId: 'p1',
  articleId: 'a1',
  templateId: 't1',
  onDeleted: async () => {},
  values: {},
  canDelete,
});

describe('useDeleteEntries — delete authority', () => {
  it('offers neither delete to a caller who is not a manager', () => {
    // Positive control first, so the absence below cannot pass vacuously —
    // e.g. if the hook were renamed and both reads were undefined anyway.
    const allowed = renderHook(() => useDeleteEntries(args(true)));
    expect(allowed.result.current.deleteOne).toBeInstanceOf(Function);
    expect(allowed.result.current.deleteSelected).toBeInstanceOf(Function);

    const refused = renderHook(() => useDeleteEntries(args(false)));
    expect(refused.result.current.deleteOne).toBeUndefined();
    expect(refused.result.current.deleteSelected).toBeUndefined();
  });
});
