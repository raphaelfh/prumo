/** TanStack read and decision for one pending OAuth consent request. */
import {useMutation, useQuery} from '@tanstack/react-query';

import {meKeys} from '@/lib/query-keys';
import {
  decideConsentRequest,
  fetchConsentRequest,
  type OAuthConsentDecisionRead,
  type OAuthConsentDecisionRequest,
  type OAuthConsentRequestRead,
} from '@/services/oauthConsentService';

/** `requestId` null (missing or malformed in the URL) sends no request. */
export function useConsentRequest(requestId: string | null) {
  return useQuery({
    queryKey: meKeys.oauthRequest(requestId ?? ''),
    queryFn: async (): Promise<OAuthConsentRequestRead> => {
      const result = await fetchConsentRequest(requestId ?? '');
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: requestId !== null,
    // A 404/409 is an answer, not a blip; a retry would only delay it.
    retry: false,
  });
}

/** No cache invalidation: on success the page leaves the app. */
export function useDecideConsent(requestId: string) {
  return useMutation<OAuthConsentDecisionRead, Error, OAuthConsentDecisionRequest>({
    mutationFn: async (body) => {
      const result = await decideConsentRequest(requestId, body);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
