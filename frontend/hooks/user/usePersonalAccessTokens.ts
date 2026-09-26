/** TanStack reads and mutations for the viewer's own personal access tokens (§4.5). */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {meKeys} from '@/lib/query-keys';
import {
  createMyToken,
  fetchMyTokens,
  revokeMyToken,
  type PersonalAccessTokenCreateRequest,
  type PersonalAccessTokenCreated,
  type PersonalAccessTokenRead,
} from '@/services/personalAccessTokenService';

export function useMyTokens() {
  return useQuery({
    queryKey: meKeys.tokens(),
    queryFn: async (): Promise<PersonalAccessTokenRead[]> => {
      const result = await fetchMyTokens();
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

function useInvalidateTokens() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({queryKey: meKeys.tokens()});
  };
}

export function useCreateMyToken() {
  const invalidate = useInvalidateTokens();
  return useMutation<PersonalAccessTokenCreated, Error, PersonalAccessTokenCreateRequest>({
    // The response carries the secret; the MutationCache must drop it as
    // soon as the component calls reset(), not 5 minutes later.
    gcTime: 0,
    mutationFn: async (body) => {
      const result = await createMyToken(body);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}

export function useRevokeMyToken() {
  const invalidate = useInvalidateTokens();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await revokeMyToken(id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: invalidate,
  });
}
