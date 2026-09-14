import {beforeEach, describe, expect, it, vi} from 'vitest';

const apiClient = vi.fn();
vi.mock('@/integrations/api', () => ({apiClient: (...a: unknown[]) => apiClient(...a)}));
// loadProjectQATemplate in the same module still imports the supabase client.
vi.mock('@/integrations/supabase/client', () => ({supabase: {}}));

import {fetchGlobalTemplates, fetchProjectTemplates} from '@/services/qaTemplateService';

describe('template catalogue reads', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('reads a project templates of one kind from the project-scoped route', async () => {
    apiClient.mockResolvedValue([{id: 'tpl-1'}]);
    const result = await fetchProjectTemplates('p1', 'quality_assessment');
    expect(apiClient).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/projects/p1/templates?kind=quality_assessment',
    );
    expect(result).toEqual({ok: true, data: [{id: 'tpl-1'}]});
  });

  it('reads the global catalogue of one kind', async () => {
    apiClient.mockResolvedValue([{id: 'g-1'}]);
    const result = await fetchGlobalTemplates('extraction');
    expect(apiClient).toHaveBeenCalledExactlyOnceWith('/api/v1/templates/global?kind=extraction');
    expect(result).toEqual({ok: true, data: [{id: 'g-1'}]});
  });

  it('returns a failed read as an error result instead of throwing', async () => {
    apiClient.mockRejectedValue(new Error('Project access denied'));
    const result = await fetchProjectTemplates('p1', 'extraction');
    expect(result.ok).toBe(false);
  });
});
