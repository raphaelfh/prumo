/**
 * TanStack Query key factory for extraction + HITL queries (runs, proposals,
 * reviewer decisions, consensus, published states).
 */
export const extractionKeys = {
  all: ['extraction'] as const,
  // Runs
  runsForProject: (projectId: string, filters?: Record<string, unknown>) =>
    [...extractionKeys.all, 'runs', projectId, filters ?? null] as const,
  runDetail: (runId: string) =>
    [...extractionKeys.all, 'run-detail', runId] as const,
  // Proposals & decisions
  proposals: (runId: string) =>
    [...extractionKeys.all, 'proposals', runId] as const,
  reviewerDecisions: (runId: string, reviewerId: string) =>
    [...extractionKeys.all, 'reviewer-decisions', runId, reviewerId] as const,
  consensus: (runId: string) =>
    [...extractionKeys.all, 'consensus', runId] as const,
  publishedValues: (runId: string) =>
    [...extractionKeys.all, 'published', runId] as const,
  // Instances / entity types
  instances: (runId: string, entityTypeId: string) =>
    [...extractionKeys.all, 'instances', runId, entityTypeId] as const,
  // HITL session
  hitlSession: (sessionId: string) =>
    [...extractionKeys.all, 'hitl-session', sessionId] as const,
} as const;
