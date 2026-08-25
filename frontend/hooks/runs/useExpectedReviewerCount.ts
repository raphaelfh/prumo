/**
 * SINGLE source of the "N of M reviewers" denominator, shared by the
 * extraction and QA run headers.
 *
 * M is role-derived — members with the reviewer or manager role — floored at
 * the number of reviewers who actually submitted decisions (PR #388 decision).
 * Never derive it from `hitl_config_snapshot.reviewer_count`: that knob is
 * inert (no UI sets it since #388), so snapshots carry the system default of 1
 * and produce nonsense like "2 of 1 reviewers" (the QA header regression).
 */

import { useProjectMembers } from "@/hooks/hitl/useProjectMembers";
import { countExpectedReviewers } from "@/lib/runs/reviewerExpectation";

export function useExpectedReviewerCount(
  projectId: string | null | undefined,
  participantCount: number,
): number {
  const members = useProjectMembers(projectId);
  return Math.max(participantCount, countExpectedReviewers(members.data ?? []));
}
