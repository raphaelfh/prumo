/**
 * The PRISMA tab's numbers. Keyed under `screeningKeys.project`, so every
 * screening mutation and a PubMed import's completion refresh it.
 */
import {useQuery} from '@tanstack/react-query';

import {screeningKeys} from '@/lib/query-keys/screening';
import {fetchPrismaCounts, type PrismaCountsRead} from '@/services/screeningService';

export function usePrismaCounts(projectId: string) {
  return useQuery({
    queryKey: screeningKeys.prisma(projectId),
    enabled: Boolean(projectId),
    // No article writer (Zotero/RIS import, manual create, delete) invalidates
    // the screening keys: under the app's 5-minute staleTime a remount would
    // otherwise keep a pre-import "Imported but not enrolled" count.
    refetchOnMount: 'always',
    queryFn: async (): Promise<PrismaCountsRead> => {
      const result = await fetchPrismaCounts(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
