/**
 * QualityAssessmentFullScreen — the section rail over a template whose
 * `scope_rules` take part of the instrument out of play for the classified
 * study type.
 *
 * The rail follows the worklist's rule (`scopedRowProgress`): an out-of-scope
 * domain owes nothing, so it adds to no count and holds no "next required" jump
 * target, open or closed. It stays on the form and on the rail.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted PER MODULE, so every suite that renders this page must
// declare the full set itself. Only the factory BODIES are shared — pulled in
// with `await import`, the one form that is safe against that hoisting.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ userId: "qa-test-reviewer-id" }),
}));

vi.mock("@/hooks/shared/useComparisonPermissions", () => ({
  useComparisonPermissions: vi.fn(),
}));

// Hoisted state the factories below read: the member roster, and each test's
// saved answers (`current_values` on the run view).
const fixture = vi.hoisted(() => ({
  members: { rows: [] as Array<Record<string, unknown>> },
  currentValues: [] as Array<Record<string, unknown>>,
}));

// A miniature PROBAST+AI: a Step-2 classifier, then one development and one
// evaluation domain, each owing a single required judgment.
vi.mock("@/integrations/supabase/client", async () => {
  const { makeSupabaseClientMock, PARTICIPANTS_DOMAIN, PROBAST_TEMPLATE, ROB_FIELD, SIGNALING_QUESTION } =
    await import("./helpers/qaFullScreenMocks");
  const domain = (id: string, name: string, label: string, sortOrder: number, fields: unknown[]) => ({
    ...PARTICIPANTS_DOMAIN,
    id,
    name,
    label,
    sort_order: sortOrder,
    extraction_fields: fields,
  });
  // ROB_FIELD's Low/High/Unclear answer set is what renders a field as a judgment.
  const judgment = (id: string, entityTypeId: string) => ({
    ...ROB_FIELD,
    id,
    entity_type_id: entityTypeId,
    is_required: true,
  });
  const studyType = {
    ...SIGNALING_QUESTION,
    id: "f-type",
    entity_type_id: "et-scope",
    name: "study_type",
    label: "Study type",
    allowed_values: ["development_only", "evaluation_only"],
  };
  return {
    supabase: makeSupabaseClientMock(fixture.members, {
      project_extraction_templates: {
        ...PROBAST_TEMPLATE,
        schema: {
          scope_rules: {
            classifier: { section: "assessment_scope", field: "study_type" },
            excludes: { development_only: ["eval_d1"] },
          },
        },
      },
      extraction_entity_types: [
        domain("et-scope", "assessment_scope", "Scope", 1, [studyType]),
        domain("et-dev", "dev_d1", "Development", 2, [judgment("f-dev", "et-dev")]),
        domain("et-eval", "eval_d1", "Evaluation", 3, [judgment("f-eval", "et-eval")]),
      ],
    }),
  };
});

// The PDF viewer pulls in worker/canvas globals (pdfjs/DOMMatrix) not worth
// wiring for a unit test — stub the component but keep the REAL (engine-free)
// store wiring from the `core` subpath, or `subscribeReaderLocate` is undefined
// and the page TypeErrors at render.
vi.mock("@prumo/pdf-viewer", async () => {
  const core =
    await vi.importActual<typeof import("@/pdf-viewer/core")>("@/pdf-viewer/core");
  return {
    PrumoPdfViewer: () => <div data-testid="qa-pdf-viewer-stub">PDF</div>,
    articleFileSourceFromStorageKey: (storageKey: string) => ({
      kind: "lazy" as const,
      load: async () => ({ kind: "url" as const, url: `stub://${storageKey}` }),
    }),
    createViewerStore: core.createViewerStore,
    subscribeReaderLocate: core.subscribeReaderLocate,
  };
});

// Spy the DOM-scroll half of the header suggestion-locate pair (jsdom has no
// scrollIntoView); the key-parsing half stays real.
vi.mock("@/lib/runs/suggestionLocate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/runs/suggestionLocate")>(
    "@/lib/runs/suggestionLocate",
  );
  return { ...actual, scrollToSectionById: vi.fn(() => true) };
});

vi.mock("@/integrations/api", async () => {
  const { makeApiClientDefault } = await import("./helpers/qaFullScreenMocks");
  const answer = makeApiClientDefault();
  return {
    apiClient: vi.fn(async (url: string) => {
      if (url === "/api/v1/hitl/sessions") {
        return {
          run_id: "run-1",
          kind: "quality_assessment",
          project_template_id: "tpl-1",
          instances_by_entity_type: { "et-scope": "i-scope", "et-dev": "i-dev", "et-eval": "i-eval" },
        };
      }
      const response = await answer(url);
      return url === "/api/v1/runs/run-1/view"
        ? { ...response, current_values: fixture.currentValues }
        : response;
    }),
  };
});

import { useComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";

import { BLIND_PERMISSIONS } from "./helpers/qaFullScreenMocks";
import { renderPage } from "./helpers/qaFullScreenRender";

const classifiedAs = (studyType: string) => ({
  instance_id: "i-scope",
  field_id: "f-type",
  value: { value: studyType },
});
const developmentJudged = { instance_id: "i-dev", field_id: "f-dev", value: { value: "Low" } };

const jumpToNextRequired = () => userEvent.keyboard("{Control>}{Enter}{/Control}");

/** A development-only assessment, rendered once the form holds its classification. */
async function renderDevelopmentOnly(answers: Array<Record<string, unknown>> = []) {
  fixture.currentValues = [classifiedAs("development_only"), ...answers];
  renderPage();
  // Precondition: unclassified, nothing is out of scope, and every assertion
  // below would hold or fail for the wrong reason.
  await screen.findByTestId("qa-out-of-scope-eval_d1");
}

describe("QualityAssessmentFullScreen — section rail over an out-of-scope domain", () => {
  beforeEach(() => {
    vi.mocked(useComparisonPermissions).mockReturnValue(BLIND_PERMISSIONS);
    // jsdom has no scrollIntoView; the jump scrolls to the row it lands on.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("counts an out-of-scope domain toward neither its own n/N nor the required left", async () => {
    await renderDevelopmentOnly([developmentJudged]);
    const rail = screen.getByRole("navigation", { name: "Section navigation" });
    expect(within(rail).getByRole("button", { name: /Development/ })).toHaveTextContent("1/1");
    expect(within(rail).getByRole("button", { name: /Evaluation/ })).toHaveTextContent("0/0");
    expect(within(rail).getByText("All required fields complete")).toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: "Go to next unfilled" })).not.toBeInTheDocument();
  });

  it("never opens an out-of-scope domain from the rail's next-unfilled jump", async () => {
    await renderDevelopmentOnly();
    const development = screen.getByTestId("qa-domain-dev_d1");
    // The button, not ⌘↵: the jump lands on a select trigger, and a second ⌘↵
    // there reaches the select itself.
    const jump = screen.getByRole("button", { name: "Go to next unfilled" });
    await userEvent.click(jump);
    await waitFor(() => expect(development).toContainElement(document.activeElement as HTMLElement));
    // The development judgment is the only one owed, so the next jump comes back
    // to it rather than opening the evaluation part.
    await userEvent.click(jump);
    expect(development).toContainElement(document.activeElement as HTMLElement);
    expect(screen.queryByTestId("qa-domain-summary-eval_d1")).not.toBeInTheDocument();
  });

  it("holds no jump target in an out-of-scope domain the reviewer opened", async () => {
    await renderDevelopmentOnly();
    const evaluation = screen.getByTestId("qa-domain-eval_d1");
    await userEvent.click(within(evaluation).getByRole("button", { name: /Evaluation/ }));
    // Its judgment is on screen and unanswered, just after the focused trigger.
    expect(await within(evaluation).findByTestId("qa-domain-summary-eval_d1")).toBeInTheDocument();
    await jumpToNextRequired();
    await waitFor(() =>
      expect(screen.getByTestId("qa-domain-dev_d1")).toContainElement(document.activeElement as HTMLElement),
    );
  });
});
