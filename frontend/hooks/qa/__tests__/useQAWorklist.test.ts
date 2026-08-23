import { describe, expect, expectTypeOf, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchProjectArticles = vi.fn();
vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: (...args: unknown[]) => fetchProjectArticles(...args),
}));

import { useQAWorklist } from '@/hooks/qa/useQAWorklist';

describe('useQAWorklist', () => {
  beforeEach(() => {
    fetchProjectArticles.mockReset();
  });

  // The title survives at RUNTIME whatever the declared type says, so the
  // behavioural case below cannot see the defect on its own. The type is the
  // defect — `RunHeader.Worklist` needs `{ id, title }[]` — so the failing
  // goal has to be stated at the type level, where `npm run typecheck` (not
  // vitest, which never typechecks) is the gate that runs it.
  it('exposes a worklist item type that carries the title', () => {
    expectTypeOf<ReturnType<typeof useQAWorklist>[number]>().toEqualTypeOf<{
      id: string;
      title: string;
    }>();
  });

  it('carries the article title through, not just the id', async () => {
    fetchProjectArticles.mockResolvedValue({
      ok: true,
      data: [{ id: 'a1', title: 'First' }, { id: 'a2', title: 'Second' }],
    });
    const { result } = renderHook(() => useQAWorklist('p1'));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0]).toEqual({ id: 'a1', title: 'First' });
  });

  // `articles.title` is nullable in the schema, so the pager and the palette
  // would otherwise have a blank row to click on.
  it('names an untitled article instead of carrying a null title', async () => {
    fetchProjectArticles.mockResolvedValue({
      ok: true,
      data: [{ id: 'a1', title: null }, { id: 'a2', title: 'Second' }],
    });
    const { result } = renderHook(() => useQAWorklist('p1'));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0]).toEqual({ id: 'a1', title: 'Untitled article' });
  });

  it('resolves to an empty list on a failed read without throwing', async () => {
    fetchProjectArticles.mockResolvedValue({ ok: false, error: { message: 'boom' } });
    const { result } = renderHook(() => useQAWorklist('p1'));
    await waitFor(() => expect(fetchProjectArticles).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
