/**
 * `useHITLProjectTemplates` — the combined shape the QA Configuration tab
 * consumes, now composed over the shared project-template query.
 *
 * The clone path is the one that cannot be proved by the extraction E2E: it
 * reads the created row back OUT of the cache to name it, which only works
 * because the mutation's invalidation is awaited before `mutateAsync`
 * resolves. These pin that, and that a no-op clone reports nothing.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const fetchProjectTemplates = vi.fn();
const fetchGlobalTemplates = vi.fn();
vi.mock('@/services/qaTemplateService', () => ({
  fetchProjectTemplates: (...a: unknown[]) => fetchProjectTemplates(...a),
  fetchGlobalTemplates: (...a: unknown[]) => fetchGlobalTemplates(...a),
}));
vi.mock('@/services/templateImportService', () => ({deleteTemplate: vi.fn()}));
const apiClient = vi.fn();
vi.mock('@/integrations/api', () => ({apiClient: (...a: unknown[]) => apiClient(...a)}));
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}));
vi.mock('sonner', () => ({toast}));

import {useHITLProjectTemplates} from '@/hooks/hitl/useHITLProjectTemplates';

const PROBAST = {
  id: 'tpl-probast',
  project_id: 'p',
  global_template_id: 'g-probast',
  name: 'PROBAST',
  description: null,
  framework: 'PROBAST',
  version: '1.0.0',
  kind: 'quality_assessment',
  is_active: true,
  created_at: '2026-08-01T00:00:00Z',
  created_by: null,
};

function wrapper() {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderTemplates() {
  return renderHook(
    () =>
      useHITLProjectTemplates({
        projectId: 'p',
        kind: 'quality_assessment',
        includeInactive: true,
      }),
    {wrapper: wrapper()},
  );
}

describe('useHITLProjectTemplates', () => {
  beforeEach(() => {
    fetchProjectTemplates.mockReset();
    fetchGlobalTemplates.mockReset();
    apiClient.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
    fetchProjectTemplates.mockResolvedValue({ok: true, data: []});
    fetchGlobalTemplates.mockResolvedValue({
      ok: true,
      data: [{id: 'g-probast', name: 'PROBAST', description: null, framework: 'PROBAST', version: '1.0.0', kind: 'quality_assessment'}],
    });
  });

  it('loads the list and the catalogue with one request each', async () => {
    const {result} = renderTemplates();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchProjectTemplates).toHaveBeenCalledExactlyOnceWith('p', 'quality_assessment', true);
    expect(fetchGlobalTemplates).toHaveBeenCalledExactlyOnceWith('quality_assessment');
    expect(result.current.globalTemplates).toHaveLength(1);
  });

  it('clone reads the created row back out of the refreshed list and names it', async () => {
    const {result} = renderTemplates();
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiClient.mockResolvedValueOnce({
      project_template_id: 'tpl-probast',
      version_id: 'v1',
      entity_type_count: 4,
      field_count: 20,
      created: true,
    });
    // The row exists only AFTER the clone — so a stale read would name ''.
    fetchProjectTemplates.mockResolvedValue({ok: true, data: [PROBAST]});

    let created: {name: string} | null = null;
    await act(async () => {
      created = await result.current.cloneTemplate('g-probast');
    });

    expect(apiClient).toHaveBeenCalledWith('/api/v1/projects/p/templates/clone', {
      method: 'POST',
      body: {global_template_id: 'g-probast', kind: 'quality_assessment'},
    });
    expect(created).toMatchObject({id: 'tpl-probast', name: 'PROBAST'});
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('PROBAST'));
    await waitFor(() => expect(result.current.templates).toHaveLength(1));
    expect(result.current.isTemplateImported('g-probast')).toBe(true);
  });

  it('a clone the server treated as a no-op reports nothing', async () => {
    const {result} = renderTemplates();
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiClient.mockResolvedValueOnce({
      project_template_id: 'tpl-probast',
      version_id: 'v1',
      entity_type_count: 4,
      field_count: 20,
      created: false,
    });
    fetchProjectTemplates.mockResolvedValue({ok: true, data: [PROBAST]});

    await act(async () => {
      await result.current.cloneTemplate('g-probast');
    });

    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a refused clone toasts and resolves to null', async () => {
    const {result} = renderTemplates();
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiClient.mockRejectedValueOnce(new Error('boom'));
    let created: unknown = 'unset';
    await act(async () => {
      created = await result.current.cloneTemplate('g-probast');
    });

    expect(created).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('setTemplateActive reports the verdict and refreshes the list', async () => {
    const {result} = renderTemplates();
    await waitFor(() => expect(result.current.loading).toBe(false));

    apiClient.mockResolvedValueOnce({project_template_id: 'tpl-probast', is_active: false});
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.setTemplateActive('tpl-probast', false);
    });
    expect(ok).toBe(true);
    expect(fetchProjectTemplates).toHaveBeenCalledTimes(2);

    apiClient.mockRejectedValueOnce(new Error('nope'));
    await act(async () => {
      ok = await result.current.setTemplateActive('tpl-probast', true);
    });
    expect(ok).toBe(false);
  });

  it('surfaces a failed list read as a message', async () => {
    fetchProjectTemplates.mockResolvedValue({ok: false, error: new Error('down')});
    const {result} = renderTemplates();
    await waitFor(() => expect(result.current.error).toBe('down'));
    expect(result.current.templates).toEqual([]);
  });
});
