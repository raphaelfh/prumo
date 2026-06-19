/**
 * Regression tests for ``useExtractionData``.
 *
 * Pins the contract that:
 *  - The active extraction template is picked DESC by ``created_at`` so
 *    Configuration and Extraction views converge on the same template
 *    (BUG #1 — split picker bug).
 *  - The hook holds ZERO entity_type / instance reads — those now come
 *    from the server RunView via ``runViewAdapters`` (consolidation).
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn(), auth: { getUser: vi.fn() } };
  return { supabase: mock };
});

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { supabase } from '@/integrations/supabase/client';
import { useExtractionData } from '@/hooks/extraction/useExtractionData';

interface Chain {
  data: unknown;
  error: { message: string; code?: string } | null;
  // recorded interactions
  __order?: { column: string; ascending: boolean | undefined };
  __filters: Array<[string, unknown]>;
}

function makeChain(data: unknown, error: Chain['error'] = null): Chain & Record<string, any> {
  const captured: Chain & Record<string, any> = {
    data,
    error,
    __filters: [],
    select: vi.fn(() => captured),
    eq: vi.fn((col: string, val: unknown) => {
      captured.__filters.push([col, val]);
      return captured;
    }),
    is: vi.fn(() => captured),
    limit: vi.fn(() => captured),
    order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
      captured.__order = { column: col, ascending: opts?.ascending };
      return captured;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error })),
    single: vi.fn(() => Promise.resolve({ data, error })),
    then: (cb: (r: { data: unknown; error: Chain['error'] }) => unknown) =>
      Promise.resolve(cb({ data, error })),
  };
  return captured;
}

const PROJECT_ID = 'proj-1';
const ARTICLE_ID = 'art-1';

beforeEach(() => {
  vi.clearAllMocks();
  (supabase.auth.getUser as any).mockResolvedValue({
    data: { user: { id: 'user-1' } },
  });
});

function primeSupabaseQueries(opts: {
  article?: any;
  project?: any;
  template?: any;
  articles?: any[];
  templateChain?: Chain & Record<string, any>;
}) {
  const articleChain = makeChain(opts.article ?? { id: ARTICLE_ID, project_id: PROJECT_ID });
  const projectChain = makeChain(opts.project ?? { id: PROJECT_ID, name: 'P1' });
  const templateChain = opts.templateChain ?? makeChain(opts.template ?? null);
  const articlesChain = makeChain(opts.articles ?? []);

  // Call order mirrors loadExtractionPhase1's parallel reads:
  //   articles(by id), projects, templates, articles(list).
  // No entity_types / instances reads fire from this hook anymore.
  (supabase.from as any)
    .mockReturnValueOnce(articleChain)
    .mockReturnValueOnce(projectChain)
    .mockReturnValueOnce(templateChain)
    .mockReturnValueOnce(articlesChain);

  return { articleChain, projectChain, templateChain, articlesChain };
}

describe('useExtractionData → active template picker', () => {
  it('orders project_extraction_templates DESC by created_at (newest active wins)', async () => {
    const tpl = { id: 'tpl-2', kind: 'extraction', is_active: true };
    const { templateChain } = primeSupabaseQueries({ template: tpl });

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(templateChain.__order).toEqual({ column: 'created_at', ascending: false });
  });

  it('filters templates by project_id, kind=extraction, is_active=true', async () => {
    const tpl = { id: 'tpl-z', kind: 'extraction', is_active: true };
    const { templateChain } = primeSupabaseQueries({ template: tpl });

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const filters = templateChain.__filters;
    expect(filters).toContainEqual(['project_id', PROJECT_ID]);
    expect(filters).toContainEqual(['is_active', true]);
    expect(filters).toContainEqual(['kind', 'extraction']);
  });

  it('exposes null template when no active extraction template exists', async () => {
    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID, enabled: false }),
    );
    // enabled=false short-circuits — loading must end at false without throwing.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.template).toBeNull();
  });

  it('skips load when projectId is undefined', async () => {
    const { result } = renderHook(() =>
      useExtractionData({ projectId: undefined, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('skips load when articleId is undefined', async () => {
    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: undefined }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('useExtractionData → no direct entity/instance reads', () => {
  it('does not expose entityTypes / instances / refreshInstances anymore', async () => {
    const tpl = { id: 'tpl-1', kind: 'extraction', is_active: true };
    primeSupabaseQueries({ template: tpl });

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const api = result.current as unknown as Record<string, unknown>;
    expect(api.entityTypes).toBeUndefined();
    expect(api.instances).toBeUndefined();
    expect(api.refreshInstances).toBeUndefined();
    // The bootstrap fields it still owns:
    expect(result.current).toHaveProperty('article');
    expect(result.current).toHaveProperty('project');
    expect(result.current).toHaveProperty('template');
    expect(result.current).toHaveProperty('articles');
    expect(typeof result.current.refresh).toBe('function');
  });
});
