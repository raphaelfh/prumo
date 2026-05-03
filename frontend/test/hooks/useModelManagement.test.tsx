import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/copy", () => ({
  t: () => "ok",
}));

vi.mock("@/integrations/api", () => ({
  createManualModelHierarchy: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn(),
  },
}));

import { createManualModelHierarchy } from "@/integrations/api";
import { useModelManagement } from "@/hooks/extraction/useModelManagement";

const createManualModelHierarchyMock =
  createManualModelHierarchy as unknown as ReturnType<typeof vi.fn>;

describe("useModelManagement", () => {
  beforeEach(() => {
    createManualModelHierarchyMock.mockReset();
  });

  it("creates a model via one backend call", async () => {
    createManualModelHierarchyMock.mockResolvedValueOnce({
      model_id: "model-1",
      model_label: "Cox",
      child_instances: [
        {
          id: "child-1",
          entity_type_id: "et-1",
          parent_instance_id: "model-1",
          label: "Cox - Population 1",
        },
      ],
    });

    const { result } = renderHook(() =>
      useModelManagement({
        projectId: "project-1",
        articleId: "article-1",
        templateId: "template-1",
        modelParentEntityTypeId: "et-parent",
        enabled: false,
      }),
    );

    await act(async () => {
      await result.current.createModel("Cox", "logistic regression");
    });

    expect(createManualModelHierarchyMock).toHaveBeenCalledWith({
      project_id: "project-1",
      article_id: "article-1",
      template_id: "template-1",
      model_name: "Cox",
      modelling_method: "logistic regression",
    });
    expect(result.current.activeModelId).toBe("model-1");
    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0].modelName).toBe("Cox");
  });
});
