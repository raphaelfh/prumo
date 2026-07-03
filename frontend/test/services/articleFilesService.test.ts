import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/api', () => ({apiClient: vi.fn()}));

import {apiClient} from '@/integrations/api';
import {
  getArticleContentMarkdown,
  listArticleFiles,
} from '@/services/articleFilesService';

const api = apiClient as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('articleFilesService.getArticleContentMarkdown', () => {
  it('GETs the content-markdown endpoint and reads the camelCase payload', async () => {
    api.mockResolvedValueOnce({
      fileName: 'teste3.pdf',
      contentMarkdown: '# Results\n\nEffect size 0.81.',
    });
    const data = await getArticleContentMarkdown('art-1');
    expect(apiClient).toHaveBeenCalledWith('/api/v1/articles/art-1/content-markdown');
    expect(data).toEqual({
      fileName: 'teste3.pdf',
      contentMarkdown: '# Results\n\nEffect size 0.81.',
    });
  });

  it('coerces missing fields to null (unparsed article)', async () => {
    api.mockResolvedValueOnce({fileName: null, contentMarkdown: null});
    expect(await getArticleContentMarkdown('art-1')).toEqual({
      fileName: null,
      contentMarkdown: null,
    });
  });

  it('propagates the apiClient error (query hook surfaces it)', async () => {
    api.mockRejectedValueOnce(new Error('boom'));
    await expect(getArticleContentMarkdown('art-1')).rejects.toThrow(/boom/);
  });
});

describe('articleFilesService.listArticleFiles', () => {
  it('returns the file list, or [] when none', async () => {
    api.mockResolvedValueOnce(null);
    expect(await listArticleFiles('art-1')).toEqual([]);
    expect(apiClient).toHaveBeenCalledWith('/api/v1/articles/art-1/files');
  });
});
