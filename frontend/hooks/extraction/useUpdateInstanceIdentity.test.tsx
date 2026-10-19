import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {toast} from 'sonner';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {ApiError} from '@/integrations/api/client';

import {useUpdateInstanceIdentity} from './useUpdateInstanceIdentity';

const updateInstanceIdentity = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/integrations/api/client')>();
  return {...actual, updateInstanceIdentity};
});
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

function wrapper({children}: {children: ReactNode}) {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false, gcTime: 0}, mutations: {retry: false}},
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const args = {
  instanceId: 'i1',
  body: {projectId: 'p1', articleId: 'a1', templateId: 't1', entityKey: 'x'},
  noun: 'model',
};

async function toastFor(error: Error): Promise<string> {
  updateInstanceIdentity.mockRejectedValue(error);
  const {result} = renderHook(() => useUpdateInstanceIdentity('run-1'), {wrapper});
  result.current.mutate(args);
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  return vi.mocked(toast.error).mock.calls[0][0] as string;
}

describe('useUpdateInstanceIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('a 409 toast includes the server message', async () => {
    const message = "An entry with the key 'x' already exists here.";
    expect(await toastFor(new ApiError('ENTRY_KEY_DUPLICATE', message, 409))).toBe(
      `Error updating model: ${message}`,
    );
  });

  it.each([
    ['404', new ApiError('NOT_FOUND', 'Instance i1 not found', 404)],
    ['network', new TypeError('Failed to fetch')],
  ])('a %s toast shows only the generic text', async (_name, err) => {
    expect(await toastFor(err)).toBe('Error updating model');
  });
});
