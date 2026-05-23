import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReviewerAvatarStack } from "@/components/runs/ReviewerAvatarStack";

describe("ReviewerAvatarStack", () => {
  it("renders nothing when reviewers list is empty", () => {
    const { container } = render(<ReviewerAvatarStack reviewers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses reviewer-* tokens (not raw sky/emerald/amber/violet/rose)", () => {
    render(
      <ReviewerAvatarStack
        reviewers={[{ id: "user-a", name: "Alice" }]}
      />,
    );
    const avatar = screen.getByTitle("Alice");
    const className = avatar.className;
    // Must use a tokenized reviewer-N class.
    expect(className).toMatch(/bg-reviewer-[1-5]/);
    // Must NOT carry the legacy raw-palette classes.
    expect(className).not.toMatch(/bg-(sky|emerald|amber|violet|rose)-\d+/);
  });

  it("assigns the same colour to the same id (deterministic hash)", () => {
    const { rerender } = render(
      <ReviewerAvatarStack
        reviewers={[{ id: "user-abc", name: "Alpha" }]}
        testId="t1"
      />,
    );
    const first = screen.getByTestId("t1-user-abc").className;
    rerender(
      <ReviewerAvatarStack
        reviewers={[{ id: "user-abc", name: "Alpha" }]}
        testId="t1"
      />,
    );
    const second = screen.getByTestId("t1-user-abc").className;
    expect(first).toBe(second);
  });

  it("collapses overflow into a +N pill", () => {
    render(
      <ReviewerAvatarStack
        reviewers={[
          { id: "1", name: "A" },
          { id: "2", name: "B" },
          { id: "3", name: "C" },
          { id: "4", name: "D" },
          { id: "5", name: "E" },
        ]}
        max={3}
      />,
    );
    expect(screen.getByLabelText("+2 more")).toBeInTheDocument();
  });
});
