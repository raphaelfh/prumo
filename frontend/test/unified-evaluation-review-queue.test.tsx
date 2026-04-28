/**
 * Tests for the UnifiedReviewQueueTable component, exercising the
 * /v1/runs hooks via React Query.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedReviewQueueTable } from "@/components/assessment/UnifiedReviewQueueTable";

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from "@/integrations/api";

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

function renderTable(runId: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnifiedReviewQueueTable runId={runId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UnifiedReviewQueueTable", () => {
  it("loads pending proposals and submits an accept decision", async () => {
    apiClientMock.mockImplementation(async (endpoint: string, options?: { method?: string }) => {
      if (endpoint === "/api/v1/runs/run-1" && !options?.method) {
        return {
          run: {
            id: "run-1",
            project_id: "project-1",
            article_id: "article-1",
            template_id: "template-1",
            kind: "extraction",
            version_id: "version-1",
            stage: "review",
            status: "active",
            hitl_config_snapshot: {},
            parameters: {},
            results: {},
            created_at: "2026-04-26T12:00:00Z",
            created_by: "user-1",
          },
          proposals: [
            {
              id: "proposal-1",
              run_id: "run-1",
              instance_id: "instance-1",
              field_id: "field-1",
              source: "ai",
              source_user_id: null,
              proposed_value: { value: "x" },
              confidence_score: 0.9,
              rationale: null,
              created_at: "2026-04-26T12:00:00Z",
            },
          ],
          decisions: [],
          consensus_decisions: [],
          published_states: [],
        };
      }
      if (endpoint === "/api/v1/runs/run-1/decisions" && options?.method === "POST") {
        return {
          id: "decision-1",
          run_id: "run-1",
          instance_id: "instance-1",
          field_id: "field-1",
          reviewer_id: "user-1",
          decision: "accept_proposal",
          proposal_record_id: "proposal-1",
          value: null,
          rationale: null,
          created_at: "2026-04-26T12:00:00Z",
        };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    const user = userEvent.setup();
    renderTable("run-1");

    await waitFor(() => {
      expect(screen.getByText("instance-1")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => {
      expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-1/decisions", {
        method: "POST",
        body: {
          instance_id: "instance-1",
          field_id: "field-1",
          decision: "accept_proposal",
          proposal_record_id: "proposal-1",
        },
      });
    });
  });

  it("renders empty-state copy when there are no pending proposals", async () => {
    apiClientMock.mockResolvedValueOnce({
      run: {
        id: "run-2",
        project_id: "project-1",
        article_id: "article-1",
        template_id: "template-1",
        kind: "extraction",
        version_id: "version-1",
        stage: "review",
        status: "active",
        hitl_config_snapshot: {},
        parameters: {},
        results: {},
        created_at: "2026-04-26T12:00:00Z",
        created_by: "user-1",
      },
      proposals: [],
      decisions: [],
      consensus_decisions: [],
      published_states: [],
    });

    renderTable("run-2");

    await waitFor(() => {
      expect(screen.getByText(/no pending review items/i)).toBeInTheDocument();
    });
  });
});
