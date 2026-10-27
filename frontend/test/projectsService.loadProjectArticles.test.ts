import {beforeEach, describe, expect, it, vi} from 'vitest';

// The paging, ordering and dedupe contract lives with the shared helper and is
// pinned in test/services/articlesService.test.ts. This file only checks that
// the project view delegates to it with the list projection.
vi.mock('@/services/articlesService', () => ({selectAllProjectArticles: vi.fn()}));

import {selectAllProjectArticles} from '@/services/articlesService';
import {loadProjectArticles} from '@/services/projectsService';
import type {Article} from '@/types/article';

const selectAll = vi.mocked(selectAllProjectArticles);

describe('loadProjectArticles', () => {
  beforeEach(() => {
    selectAll.mockReset();
  });

  it('delegates to the shared project article pager', async () => {
    const articles = [{id: 'a1'}, {id: 'a2'}] as Article[];
    selectAll.mockResolvedValue(articles);

    const result = await loadProjectArticles('p1');

    expect(result).toEqual({ok: true, data: articles});
    expect(selectAll).toHaveBeenCalledTimes(1);
    const [projectId, columns] = selectAll.mock.calls[0];
    expect(projectId).toBe('p1');
    expect(columns).toContain('abstract');
    expect(columns).toContain('created_at');
  });

  it('turns a pager failure into an ErrorResult', async () => {
    selectAll.mockRejectedValue(new Error('boom'));

    const result = await loadProjectArticles('p1');

    expect(result.ok).toBe(false);
  });
});
