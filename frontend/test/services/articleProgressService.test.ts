import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api', () => ({apiClient: apiClientMock}));

import {getArticleProgress} from '@/services/articleProgressService';

beforeEach(() => apiClientMock.mockReset());

describe('articleProgressService.getArticleProgress', () => {
  it('requests the article-progress route with the kind', async () => {
    const read = {articles: []};
    apiClientMock.mockResolvedValueOnce(read);
    await expect(getArticleProgress('proj-1', 'tpl-1', 'quality_assessment')).resolves.toBe(read);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/proj-1/templates/tpl-1/article-progress?kind=quality_assessment',
    );
  });
});
