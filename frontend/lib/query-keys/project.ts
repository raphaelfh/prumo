/**
 * TanStack Query key factory for project-scoped queries.
 * See `./README.md` for the convention; do not inline `queryKey: ['projects', ...]`
 * at call sites.
 */
export const projectKeys = {
  all: ['projects'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...projectKeys.all, 'list', filters ?? null] as const,
  detail: (projectId: string) =>
    [...projectKeys.all, 'detail', projectId] as const,
  members: (projectId: string) =>
    [...projectKeys.all, 'members', projectId] as const,
  templates: (projectId: string) =>
    [...projectKeys.all, 'templates', projectId] as const,
  hitlConfig: (projectId: string) =>
    [...projectKeys.all, 'hitl-config', projectId] as const,
} as const;
