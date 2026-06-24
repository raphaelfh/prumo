import type { ProjectMemberSummary } from "@/hooks/hitl/useProjectMembers";

/**
 * Roles whose members are expected to extract — the denominator for the
 * "N of M reviewers" header. Viewers never extract; a pure consensus role only
 * arbitrates. Managers commonly extract, so they count.
 */
const EXPECTED_ROLES: ReadonlySet<string> = new Set(["reviewer", "manager"]);

export function countExpectedReviewers(
  members: readonly ProjectMemberSummary[],
): number {
  return members.filter((mbr) => EXPECTED_ROLES.has(mbr.role)).length;
}
