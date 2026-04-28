/**
 * Tests for the UnifiedConsensusPanel component, exercising the
 * /v1/runs hooks via React Query.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedConsensusPanel } from "@/components/assessment/UnifiedConsensusPanel";

vi.mock("@/integrations/api", () => ({
  apiClient: vi.fn(),
}));

import { apiClient } from "@/integrations/api";

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnifiedConsensusPanel
        runId="run-1"
        instanceId="instance-1"
        fieldId="field-1"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UnifiedConsensusPanel", () => {
  it("publishes consensus by POSTing /api/v1/runs/{runId}/consensus", async () => {
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
            stage: "consensus",
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
        };
      }
      if (endpoint === "/api/v1/runs/run-1/consensus" && options?.method === "POST") {
        return {
          consensus: {
            id: "consensus-1",
            run_id: "run-1",
            instance_id: "instance-1",
            field_id: "field-1",
            consensus_user_id: "user-1",
            mode: "manual_override",
            selected_decision_id: null,
            value: { approved: true },
            rationale: "Documented override",
            created_at: "2026-04-26T12:00:00Z",
          },
          published: {
            id: "published-1",
            run_id: "run-1",
            instance_id: "instance-1",
            field_id: "field-1",
            value: { approved: true },
            published_at: "2026-04-26T12:00:00Z",
            published_by: "user-1",
            version: 1,
          },
        };
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    const user = userEvent.setup();
    renderPanel();

    await user.type(
      screen.getByPlaceholderText(/override justification/i),
      "Documented override",
    );
    await user.click(screen.getByRole("button", { name: /publish consensus/i }));

    await waitFor(() => {
      expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs/run-1/consensus", {
        method: "POST",
        body: {
          instance_id: "instance-1",
          field_id: "field-1",
          mode: "manual_override",
          value: { approved: true },
          rationale: "Documented override",
        },
      });
    });
  });
});
