import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QualityAssessmentFullScreen from "@/pages/QualityAssessmentFullScreen";

describe("QualityAssessmentFullScreen", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: "tpl-1",
          name: "PROBAST",
          description: "Prediction model Risk Of Bias ASsessment Tool",
          kind: "quality_assessment",
          framework: "CUSTOM",
        },
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with QA badge + template name once loaded", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/p1/articles/a1/quality-assessment/tpl-1",
        ]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/articles/:articleId/quality-assessment/:templateId"
            element={<QualityAssessmentFullScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("qa-kind-badge")).toHaveTextContent(
      "Quality Assessment",
    );
    await waitFor(() =>
      expect(screen.getByTestId("qa-template-name")).toHaveTextContent(
        "PROBAST",
      ),
    );
  });

  it("renders the AssessmentShell with PDF collapsed by default (Show PDF visible)", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/p1/articles/a1/quality-assessment/tpl-1",
        ]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/articles/:articleId/quality-assessment/:templateId"
            element={<QualityAssessmentFullScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("assessment-shell")).toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-show-pdf")).toBeInTheDocument();
    // PDF panel hidden until user clicks "Show PDF"
    expect(
      screen.queryByTestId("assessment-shell-pdf"),
    ).not.toBeInTheDocument();
  });

  it("renders the form panel placeholder", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/p1/articles/a1/quality-assessment/tpl-1",
        ]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/articles/:articleId/quality-assessment/:templateId"
            element={<QualityAssessmentFullScreen />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("qa-form-panel")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/quality-assessment form rendering/i)).toBeInTheDocument(),
    );
  });
});
