/** TanStack read and revoke for the viewer's OAuth connections (apps connected to prumo's MCP server). */
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {meKeys} from '@/lib/query-keys';
import {
  fetchMyConnections,
  revokeMyConnection,
  type OAuthConnectionRead,
} from '@/services/oauthConnectionsService';

export function useMyOAuthConnections() {
  return useQuery({
    queryKey: meKeys.oauthConnections(),
    queryFn: async (): Promise<OAuthConnectionRead[]> => {
      const result = await fetchMyConnections();
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

/** The row's status is server-computed: refetch the list instead of patching it. */
export function useRevokeOAuthConnection() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const result = await revokeMyConnection(id);
      if (!result.ok) throw result.error;
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: meKeys.oauthConnections()});
    },
  });
}
