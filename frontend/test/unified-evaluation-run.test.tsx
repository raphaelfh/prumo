/**
 * Tests for the UnifiedEvaluationRunPanel component, exercising the
 * /v1/runs hooks via React Query.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedEvaluationRunPanel } from "@/components/extraction/UnifiedEvaluationRunPanel";

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
      <UnifiedEvaluationRunPanel
        projectId="project-1"
        articleId="article-1"
        projectTemplateId="template-1"
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

describe("UnifiedEvaluationRunPanel", () => {
  it("creates a new run by POSTing /api/v1/runs and surfaces the run id", async () => {
    apiClientMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/v1/runs") {
        return {
          id: "run-created",
          project_id: "project-1",
          article_id: "article-1",
          template_id: "template-1",
          kind: "extraction",
          version_id: "version-1",
          stage: "pending",
          status: "pending",
          hitl_config_snapshot: {},
          parameters: {},
          results: {},
          created_at: "2026-04-26T12:00:00Z",
          created_by: "user-1",
        };
      }
      if (endpoint === "/api/v1/runs/run-created") {
        return {
          run: {
            id: "run-created",
            project_id: "project-1",
            article_id: "article-1",
            template_id: "template-1",
            kind: "extraction",
            version_id: "version-1",
            stage: "pending",
            status: "pending",
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
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /create run/i }));

    await waitFor(() => {
      expect(screen.getByText(/run-created/)).toBeInTheDocument();
    });

    expect(apiClientMock).toHaveBeenCalledWith("/api/v1/runs", {
      method: "POST",
      body: {
        project_id: "project-1",
        article_id: "article-1",
        project_template_id: "template-1",
      },
    });
  });
});
