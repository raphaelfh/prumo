import {renderHook, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const getTemplateInstruction = vi.fn();
const updateTemplateInstruction = vi.fn();
vi.mock('@/services/templateInstructionService', () => ({
  getTemplateInstruction: (...a: unknown[]) => getTemplateInstruction(...a),
  updateTemplateInstruction: (...a: unknown[]) => updateTemplateInstruction(...a),
}));

import {
  useTemplateInstruction,
  useUpdateTemplateInstruction,
} from '@/hooks/extraction/useTemplateInstruction';
import {runsKeys} from '@/hooks/runs/types';
import {
  templateConfigStatusKeys,
  templateInstructionKeys,
} from '@/lib/query-keys/extraction';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return {
    queryClient,
    wrapper: ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTemplateInstruction', () => {
  it('fetches the instruction for the template', async () => {
    getTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'Text',
      default_instruction: null,
    });
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useTemplateInstruction('p1', 't1'), {wrapper});
    await waitFor(() => expect(result.current.data?.llm_template_instruction).toBe('Text'));
    expect(getTemplateInstruction).toHaveBeenCalledWith('p1', 't1');
  });
});

describe('useUpdateTemplateInstruction', () => {
  it('puts the value and refreshes the instruction + Draft chip queries', async () => {
    // B-4 response shape: a draft edit — no version fields.
    updateTemplateInstruction.mockResolvedValue({
      project_template_id: 't1',
      llm_template_instruction: 'New',
    });
    const {queryClient, wrapper} = createWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useUpdateTemplateInstruction('p1', 't1'), {
      wrapper,
    });
    result.current.mutate('New');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateTemplateInstruction).toHaveBeenCalledWith('p1', 't1', 'New');
    // Factory call, NOT a literal array — check_react_query_keys.py flags
    // literal queryKey arrays anywhere under frontend/, tests included.
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateInstructionKeys.byTemplate('p1', 't1'),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: templateConfigStatusKeys.byTemplate('p1', 't1'),
      }),
    );
    // Nothing re-pins on a draft edit — the runs cache must NOT churn.
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({queryKey: runsKeys.all}),
    );
  });
});
