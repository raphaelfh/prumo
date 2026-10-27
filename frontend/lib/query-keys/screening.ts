/**
 * TanStack Query keys for title/abstract screening. Every screening read of a
 * project sits under `project(projectId)`, so every screening mutation
 * invalidates that one prefix. A record read is keyed by its assignment id
 * alone (the route carries no project), so a decision invalidates it too.
 */
export const screeningKeys = {
  all: ['screening'] as const,
  project: (projectId: string) => [...screeningKeys.all, 'project', projectId] as const,
  config: (projectId: string) => [...screeningKeys.project(projectId), 'config'] as const,
  importRun: (projectId: string, syncRunId: string) =>
    [...screeningKeys.project(projectId), 'import-run', syncRunId] as const,
  queue: (projectId: string) => [...screeningKeys.project(projectId), 'queue'] as const,
  conflicts: (projectId: string) => [...screeningKeys.project(projectId), 'conflicts'] as const,
  prisma: (projectId: string) => [...screeningKeys.project(projectId), 'prisma'] as const,
  assignment: (assignmentId: string) => [...screeningKeys.all, 'assignment', assignmentId] as const,
} as const;
