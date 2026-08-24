/**
 * API Client exports.
 *
 * Only the surface callers actually reach for through this barrel. Everything
 * else in ./client (ApiError, zoteroClient, modelExtractionClient, the request
 * and response types) is imported from '@/integrations/api/client' directly —
 * the convention in .claude/rules/frontend.md — so re-exporting it here only
 * duplicated the surface.
 */

export {
  apiClient,
  createManualModelHierarchy,
  type ManualModelHierarchyChild,
} from "./client";
