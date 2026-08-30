/**
 * `renderPage` for the QualityAssessmentFullScreen suites.
 *
 * Split from `qaFullScreenMocks.tsx` on purpose. That module is imported from
 * INSIDE `vi.mock` factories, and this one imports the page under test — if the
 * two lived together, every mock factory would drag the component into its own
 * import graph and evaluate it before the mocks it depends on were registered.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { SidebarProvider } from "@/contexts/SidebarContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import QualityAssessmentFullScreen from "@/pages/QualityAssessmentFullScreen";

/** Renders the live URL so navigation assertions read it straight off the DOM. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="probe-location">{`${loc.pathname}${loc.search}`}</div>;
}

export const DEFAULT_QA_PATH =
  "/projects/p1/articles/a1/quality-assessment/tpl-1";

export function renderPage(path = DEFAULT_QA_PATH) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/projects/:projectId/articles/:articleId/quality-assessment/:templateId"
            element={
              // TooltipProvider mirrors the app-level provider in App.tsx —
              // form-panel tooltips (suggestion rows) rely on it in prod.
              <TooltipProvider>
                <SidebarProvider>
                  <QualityAssessmentFullScreen />
                </SidebarProvider>
              </TooltipProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
