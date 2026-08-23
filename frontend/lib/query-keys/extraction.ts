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
  // Export dialog (feature 009)
  exportReviewers: (projectId: string, templateId: string) =>
    [...extractionKeys.all, 'export-reviewers', projectId, templateId] as const,
  exportJobStatus: (projectId: string, jobId: string) =>
    [...extractionKeys.all, 'export-status', projectId, jobId] as const,
  // Async section extraction job polling (B4/B5)
  job: (jobId: string) =>
    [...extractionKeys.all, 'section-job', jobId] as const,
} as const;

/**
 * Key factory for live template structure reads (entity types + fields).
 * Lives here (not in the hook) so republish flows can invalidate without
 * importing the hook module's supabase dependency chain.
 */
export const templateEntityTypesKeys = {
  all: ['template-entity-types'] as const,
  byTemplate: (templateId: string) =>
    ['template-entity-types', templateId] as const,
};

/** Template general AI instruction (Configuration row zero). */
/** ACTIVE-version template structure (worklist/dashboard reads, B-3a). */
export const templateActiveStructureKeys = {
  all: ['template-active-structure'] as const,
  byTemplate: (projectId: string, templateId: string) =>
    ['template-active-structure', projectId, templateId] as const,
};

export const templateInstructionKeys = {
  byTemplate: (projectId: string, templateId: string) =>
    ['template-instruction', projectId, templateId] as const,
};

/** Draft/publish status for the Configuration tab's chip (B-4). */
export const templateConfigStatusKeys = {
  all: ['template-config-status'] as const,
  byTemplate: (projectId: string, templateId: string) =>
    ['template-config-status', projectId, templateId] as const,
};

/** The published-version timeline behind the History sheet (B-9e). */
export const templateVersionHistoryKeys = {
  all: ['template-version-history'] as const,
  byTemplate: (projectId: string, templateId: string) =>
    ['template-version-history', projectId, templateId] as const,
};

/** What the open draft would publish, bucketed by tier (B-9b2a). */
export const templateDiffKeys = {
  byTemplate: (projectId: string, templateId: string) =>
    ['template-config-diff', projectId, templateId] as const,
};

/**
 * The project's own HITL templates (`project_extraction_templates`), by
 * kind. `includeInactive` is part of the identity because it changes the
 * server-side filter: the QA Configuration tab and the "switch template"
 * list need the deactivated rows, every other reader wants the active set.
 *
 * Every write that adds, activates, or removes a project template
 * invalidates `.all` — an import may land on a DIFFERENT template than the
 * one on screen, so a scoped invalidation would miss it.
 */
export const projectTemplatesKeys = {
  all: ['project-templates'] as const,
  byProject: (projectId: string, kind: string, includeInactive: boolean) =>
    [...projectTemplatesKeys.all, projectId, kind, includeInactive] as const,
};

/** The global catalogue offered for import, by kind (read-only). */
export const globalTemplateCatalogueKeys = {
  all: ['global-template-catalogue'] as const,
  byKind: (kind: string) => [...globalTemplateCatalogueKeys.all, kind] as const,
};
