/**
 * TanStack Query keys for title/abstract screening. Every screening read of a
 * project sits under `project(projectId)`, so every screening mutation — and
 * every article write, through `invalidateScreening` — invalidates that one
 * prefix. A record read is keyed by its assignment id alone (the route carries
 * no project), so a decision invalidates it too.
 */
import type {QueryClient} from '@tanstack/react-query';

import type {components} from '@/types/api/schema';

type ScreeningPhase = components['schemas']['ScreeningRecordsRead']['phase'];

export const screeningKeys = {
  all: ['screening'] as const,
  project: (projectId: string) => [...screeningKeys.all, 'project', projectId] as const,
  config: (projectId: string) => [...screeningKeys.project(projectId), 'config'] as const,
  importRun: (projectId: string, syncRunId: string) =>
    [...screeningKeys.project(projectId), 'import-run', syncRunId] as const,
  records: (projectId: string, phase?: ScreeningPhase) =>
    phase
      ? ([...screeningKeys.project(projectId), 'records', phase] as const)
      : ([...screeningKeys.project(projectId), 'records'] as const),
  prisma: (projectId: string) => [...screeningKeys.project(projectId), 'prisma'] as const,
  duplicates: (projectId: string) => [...screeningKeys.project(projectId), 'duplicates'] as const,
  assignment: (assignmentId: string) => [...screeningKeys.all, 'assignment', assignmentId] as const,
} as const;

/** Refetch every screening read of the project: an article was created, edited, deleted or imported. */
export function invalidateScreening(queryClient: QueryClient, projectId: string): Promise<void> {
  return queryClient.invalidateQueries({queryKey: screeningKeys.project(projectId)});
}
