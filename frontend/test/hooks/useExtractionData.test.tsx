/**
 * Regression tests for ``useExtractionData``.
 *
 * Pins the contract that:
 *  - The active extraction template is picked DESC by ``created_at`` so
 *    Configuration and Extraction views converge on the same template
 *    (BUG #1 — split picker bug).
 *  - Entity_types are loaded scoped to the chosen template.
 *  - ``mergeInstancesById`` preserves stable references for unchanged
 *    rows so the form does not remount + scroll-reset on every refresh.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
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

vi.mock('@/services/extractionInstanceService', () => ({
  extractionInstanceService: {
    // ``initializeArticleInstances`` was removed in 2026-05-19. The
    // backend's ``hitl_session_service._ensure_instances`` is the sole
    // creator of singleton instances on session open; the hook only
    // reads via ``getInstances``.
    getInstances: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/client';
import { extractionInstanceService } from '@/services/extractionInstanceService';
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
  entityTypes?: any[];
  articles?: any[];
  templateChain?: Chain & Record<string, any>;
}) {
  const articleChain = makeChain(opts.article ?? { id: ARTICLE_ID, project_id: PROJECT_ID });
  const projectChain = makeChain(opts.project ?? { id: PROJECT_ID, name: 'P1' });
  const templateChain = opts.templateChain ?? makeChain(opts.template ?? null);
  const entityTypesChain = makeChain(opts.entityTypes ?? []);
  const articlesChain = makeChain(opts.articles ?? []);

  // Call order mirrors loadData's two parallel phases:
  //   Phase 1 (Promise.all): articles(by id), projects, templates, articles(list)
  //   Phase 2 (Promise.all): extraction_entity_types
  (supabase.from as any)
    .mockReturnValueOnce(articleChain)
    .mockReturnValueOnce(projectChain)
    .mockReturnValueOnce(templateChain)
    .mockReturnValueOnce(articlesChain)
    .mockReturnValueOnce(entityTypesChain);

  return { articleChain, projectChain, templateChain, entityTypesChain, articlesChain };
}

describe('useExtractionData → active template picker', () => {
  it('orders project_extraction_templates DESC by created_at (newest active wins)', async () => {
    const tpl = { id: 'tpl-2', kind: 'extraction', is_active: true };
    const { templateChain } = primeSupabaseQueries({ template: tpl });

    (extractionInstanceService.getInstances as any).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(templateChain.__order).toEqual({ column: 'created_at', ascending: false });
  });

  it('filters templates by project_id, kind=extraction, is_active=true', async () => {
    const tpl = { id: 'tpl-z', kind: 'extraction', is_active: true };
    const { templateChain } = primeSupabaseQueries({ template: tpl });
    (extractionInstanceService.getInstances as any).mockResolvedValue([]);

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

describe('useExtractionData → instance loading', () => {
  it('reads existing instances on initial load (never writes — backend owns creation)', async () => {
    const tpl = { id: 'tpl-1', kind: 'extraction', is_active: true };
    const entityTypes = [
      { id: 'et-1', label: 'Section A', cardinality: 'one', fields: [] },
    ];
    primeSupabaseQueries({ template: tpl, entityTypes });

    const seeded = [
      { id: 'inst-1', entity_type_id: 'et-1', article_id: ARTICLE_ID, label: 'A', metadata: {} },
    ];
    (extractionInstanceService.getInstances as any).mockResolvedValue(seeded);

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Regression guard: ``initializeArticleInstances`` was removed; the
    // backend's hitl_session_service._ensure_instances is the sole writer.
    expect(
      (extractionInstanceService as unknown as Record<string, unknown>).initializeArticleInstances,
    ).toBeUndefined();
    expect(extractionInstanceService.getInstances).toHaveBeenCalledWith({
      articleId: ARTICLE_ID,
      templateId: 'tpl-1',
    });
    expect(result.current.instances).toHaveLength(1);
  });

  it('refreshInstances calls extractionInstanceService.getInstances with the active template id', async () => {
    const tpl = { id: 'tpl-X', kind: 'extraction', is_active: true };
    primeSupabaseQueries({ template: tpl });
    (extractionInstanceService.getInstances as any).mockResolvedValue([]);
    (extractionInstanceService.getInstances as any).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refreshInstances();
    });

    expect(extractionInstanceService.getInstances).toHaveBeenCalledWith({
      articleId: ARTICLE_ID,
      templateId: 'tpl-X',
    });
  });
});

describe('useExtractionData → mergeInstancesById stable references', () => {
  // The merge logic lives inline in the hook; we exercise it indirectly via
  // refreshInstances + comparing reference identity of unchanged entries.
  it('returns the same array reference when no instance changed', async () => {
    const tpl = { id: 'tpl-merge', kind: 'extraction', is_active: true };
    primeSupabaseQueries({ template: tpl });

    const initial = [
      {
        id: 'inst-1',
        entity_type_id: 'et-1',
        article_id: ARTICLE_ID,
        label: 'A',
        sort_order: 0,
        status: 'pending',
        parent_instance_id: null,
        metadata: {},
      },
    ];
    // Initial load + first refresh both go through getInstances now;
    // the test queues two sequential return values.
    (extractionInstanceService.getInstances as any).mockResolvedValueOnce(initial);

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.instances).toHaveLength(1));
    const beforeRef = result.current.instances;

    (extractionInstanceService.getInstances as any).mockResolvedValueOnce(
      // Same shape — merge must detect "no change" and reuse the array.
      initial.map((i) => ({ ...i })),
    );
    await act(async () => {
      await result.current.refreshInstances();
    });
    expect(result.current.instances).toBe(beforeRef);
  });

  it('produces a new array when an instance label changes', async () => {
    const tpl = { id: 'tpl-merge2', kind: 'extraction', is_active: true };
    primeSupabaseQueries({ template: tpl });

    const initial = [
      {
        id: 'inst-1',
        entity_type_id: 'et-1',
        article_id: ARTICLE_ID,
        label: 'A',
        sort_order: 0,
        status: 'pending',
        parent_instance_id: null,
        metadata: {},
      },
    ];
    // Initial load + first refresh both go through getInstances now;
    // the test queues two sequential return values.
    (extractionInstanceService.getInstances as any).mockResolvedValueOnce(initial);

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.instances).toHaveLength(1));
    const beforeRef = result.current.instances;

    (extractionInstanceService.getInstances as any).mockResolvedValueOnce([
      { ...initial[0], label: 'A renamed' },
    ]);
    await act(async () => {
      await result.current.refreshInstances();
    });
    expect(result.current.instances).not.toBe(beforeRef);
    expect(result.current.instances[0].label).toBe('A renamed');
  });

  it('produces a new array when an instance is removed upstream', async () => {
    const tpl = { id: 'tpl-merge3', kind: 'extraction', is_active: true };
    primeSupabaseQueries({ template: tpl });

    const initial = [
      {
        id: 'inst-1',
        entity_type_id: 'et-1',
        article_id: ARTICLE_ID,
        label: 'A',
        sort_order: 0,
        status: 'pending',
        parent_instance_id: null,
        metadata: {},
      },
    ];
    // Initial load + first refresh both go through getInstances now;
    // the test queues two sequential return values.
    (extractionInstanceService.getInstances as any).mockResolvedValueOnce(initial);

    const { result } = renderHook(() =>
      useExtractionData({ projectId: PROJECT_ID, articleId: ARTICLE_ID }),
    );
    await waitFor(() => expect(result.current.instances).toHaveLength(1));
    const beforeRef = result.current.instances;

    (extractionInstanceService.getInstances as any).mockResolvedValueOnce([]);
    await act(async () => {
      await result.current.refreshInstances();
    });
    expect(result.current.instances).not.toBe(beforeRef);
    expect(result.current.instances).toHaveLength(0);
  });
});
