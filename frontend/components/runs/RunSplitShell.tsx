import { ReactNode } from "react";
import type { StoreApi } from "zustand";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
// Import from the engine-free `core` subpath (not the barrel) so the shell does
// not pull pdfjs into its module graph — the viewer engine arrives via the
// PrumoPdfViewer the pages pass as `pdfPanel`, not through this shell.
import { ViewerProvider, type ViewerState } from "@/pdf-viewer/core";
import { usePdfPanel, type UsePdfPanelResult } from "@/hooks/usePdfPanel";

export interface RunSplitShellProps {
  /** PDF/markdown viewer content for the RIGHT panel (order 2). */
  pdfPanel: ReactNode;
  /** Form / evaluation content for the LEFT panel (order 1). */
  formPanel: ReactNode;
  /** Optional sticky header above the panels. */
  header?: ReactNode;
  /** Optional strip between header and panels (e.g. HITL status badges). */
  subHeader?: ReactNode;
  /** When true, the PDF panel starts open. Default false (collapsed). */
  initialPdfOpen?: boolean;
  /** Externally-owned PDF panel state (so a RunHeader.PanelToggle can drive it). */
  pdfState?: UsePdfPanelResult;
  /**
   * Shared viewer store. When provided, BOTH panels are wrapped in one
   * <ViewerProvider store={viewerStore}> so the form panel's evidence popover
   * (useReaderLocate) and the PDF reader resolve the SAME store. The PDF
   * content passed as `pdfPanel` MUST also thread `store={viewerStore}` into
   * its <PrumoPdfViewer> — the provider wrap alone is not sufficient because
   * Viewer.Root self-creates a store when none is passed.
   */
  viewerStore?: StoreApi<ViewerState>;
}

/**
 * Shared split-workspace shell for the Extraction + Quality-Assessment session
 * screens. Canonical layout: form LEFT (order 1), PDF RIGHT (order 2).
 *
 * NOTE: keeps the legacy `assessment-shell*` data-testids (consumed by the QA
 * fullscreen test) even though the component is named RunSplitShell.
 */
export function RunSplitShell({
  pdfPanel,
  formPanel,
  header,
  subHeader,
  initialPdfOpen = false,
  pdfState,
  viewerStore,
}: RunSplitShellProps) {
  const internalPdf = usePdfPanel({ initialOpen: initialPdfOpen });
  const pdf = pdfState ?? internalPdf;

  const panels = (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        id="run-split-form"
        order={1}
        defaultSize={pdf.isOpen ? 50 : 100}
        minSize={30}
        data-testid="assessment-shell-form"
      >
        <div className="flex h-full flex-col">
          {/* In-shell PDF toggle: hidden when the caller owns the toggle
              (e.g. a page wiring RunHeader.PanelToggle via pdfState). */}
          {!pdfState && (
            <div className="flex shrink-0 items-center justify-end px-3 py-2">
              {pdf.isOpen ? (
                <button
                  type="button"
                  onClick={pdf.close}
                  className="text-sm text-muted-foreground hover:underline"
                  data-testid="assessment-shell-hide-pdf"
                >
                  Hide PDF
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pdf.open}
                  className="text-sm text-muted-foreground hover:underline"
                  data-testid="assessment-shell-show-pdf"
                >
                  Show PDF
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">{formPanel}</div>
        </div>
      </ResizablePanel>
      {pdf.isOpen ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="run-split-pdf"
            order={2}
            defaultSize={50}
            minSize={30}
            maxSize={70}
            data-testid="assessment-shell-pdf"
          >
            {pdfPanel}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );

  return (
    <div className="flex h-full w-full flex-col" data-testid="assessment-shell">
      {header ? <div className="shrink-0">{header}</div> : null}
      {subHeader ? <div className="shrink-0">{subHeader}</div> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {viewerStore ? (
          <ViewerProvider store={viewerStore}>{panels}</ViewerProvider>
        ) : (
          panels
        )}
      </div>
    </div>
  );
}
