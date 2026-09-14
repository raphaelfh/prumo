import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const fetchProjectTemplates = vi.fn();
const fetchGlobalTemplates = vi.fn();
vi.mock('@/services/qaTemplateService', () => ({
  fetchProjectTemplates: (...a: unknown[]) => fetchProjectTemplates(...a),
  fetchGlobalTemplates: (...a: unknown[]) => fetchGlobalTemplates(...a),
}));
vi.mock('@/services/templateImportService', () => ({deleteTemplate: vi.fn()}));
vi.mock('@/integrations/api', () => ({apiClient: vi.fn()}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {useQATemplateResolution} from '@/hooks/qa/useQATemplateResolution';

function renderResolution(templateId: string) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useQATemplateResolution('p1', templateId), {wrapper});
}

describe('useQATemplateResolution', () => {
  beforeEach(() => {
    fetchProjectTemplates.mockReset();
    fetchGlobalTemplates.mockReset();
    fetchProjectTemplates.mockResolvedValue({ok: true, data: [{id: 'tpl-project'}]});
    fetchGlobalTemplates.mockResolvedValue({ok: true, data: [{id: 'tpl-global'}]});
  });

  it('reads the QA templates of the project in the route', async () => {
    const {result} = renderResolution('tpl-project');
    expect(result.current.resolution).toEqual({kind: 'pending'});
    await waitFor(() => expect(result.current.resolution.kind).not.toBe('pending'));
    expect(fetchProjectTemplates).toHaveBeenCalledWith('p1', 'quality_assessment');
    expect(fetchGlobalTemplates).toHaveBeenCalledWith('quality_assessment');
  });

  it('resolves an id among the project templates as a project template', async () => {
    const {result} = renderResolution('tpl-project');
    await waitFor(() => expect(result.current.resolution).toEqual({kind: 'project', id: 'tpl-project'}));
  });

  it('resolves a catalogue id as a global template', async () => {
    const {result} = renderResolution('tpl-global');
    await waitFor(() => expect(result.current.resolution).toEqual({kind: 'global', id: 'tpl-global'}));
  });

  it('resolves an id in neither list as missing', async () => {
    const {result} = renderResolution('tpl-of-another-project');
    await waitFor(() => expect(result.current.resolution).toEqual({kind: 'missing'}));
  });

  it('resolves a failed read as an error, never as missing', async () => {
    fetchProjectTemplates.mockResolvedValue({ok: false, error: new Error('network down')});
    const {result} = renderResolution('tpl-project');
    await waitFor(() => expect(result.current.resolution).toEqual({kind: 'error'}));
  });

  it('resolves a failed catalogue read as an error when the project list lacks the id', async () => {
    fetchGlobalTemplates.mockResolvedValue({ok: false, error: new Error('network down')});
    const {result} = renderResolution('tpl-global');
    await waitFor(() => expect(result.current.resolution).toEqual({kind: 'error'}));
  });
});
