import { describe, expect, it } from "vitest";
import { countExpectedReviewers } from "@/lib/runs/reviewerExpectation";
import type { ProjectMemberSummary } from "@/hooks/hitl/useProjectMembers";

const m = (role: ProjectMemberSummary["role"]): ProjectMemberSummary => ({
  user_id: `u-${role}-${Math.round(role.length)}`,
  role,
  user_email: null,
  user_full_name: null,
  user_avatar_url: null,
});

describe("countExpectedReviewers", () => {
  it("counts reviewer and manager roles", () => {
    expect(countExpectedReviewers([m("reviewer"), m("manager"), m("reviewer")])).toBe(3);
  });
  it("excludes viewer and pure consensus roles", () => {
    expect(countExpectedReviewers([m("reviewer"), m("viewer"), m("consensus")])).toBe(1);
  });
  it("returns 0 for an empty roster", () => {
    expect(countExpectedReviewers([])).toBe(0);
  });
});
