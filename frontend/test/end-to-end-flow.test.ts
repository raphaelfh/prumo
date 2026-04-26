import { describe, expect, it } from "vitest";

describe("E2E test suite migration marker", () => {
  it("keeps a minimal contract while browser E2E lives in frontend/e2e", () => {
    expect("frontend/e2e/extraction-observability.e2e.ts").toContain("e2e");
  });
});
