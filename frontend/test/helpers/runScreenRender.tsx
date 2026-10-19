/**
 * `renderExtractionPage` / `renderQaPage` for the run-screen page suites.
 *
 * Split from `runScreenFixtures.ts` on purpose. That module is imported from
 * INSIDE `vi.mock` factories, and this one imports the pages under test — if
 * the two lived together, every mock factory would drag a page into its own
 * import graph and evaluate it before the mocks it depends on were registered.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { SidebarProvider } from "@/contexts/SidebarContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import ExtractionFullScreen from "@/pages/ExtractionFullScreen";
import QualityAssessmentFullScreen from "@/pages/QualityAssessmentFullScreen";

/** Renders the live URL so navigation assertions read it straight off the DOM. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAt(path: string, routePath: string, page: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route
            path={routePath}
            element={
              // TooltipProvider mirrors the app-level provider in App.tsx —
              // form-panel tooltips (suggestion rows) rely on it in prod.
              <TooltipProvider>
                <SidebarProvider>{page}</SidebarProvider>
              </TooltipProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

export function renderExtractionPage(path = "/projects/p1/extraction/a1") {
  return renderAt(path, "/projects/:projectId/extraction/:articleId", <ExtractionFullScreen />);
}

const DEFAULT_QA_PATH = "/projects/p1/articles/a1/quality-assessment/tpl-1";

export function renderQaPage(path = DEFAULT_QA_PATH) {
  return renderAt(
    path,
    "/projects/:projectId/articles/:articleId/quality-assessment/:templateId",
    <QualityAssessmentFullScreen />,
  );
}
