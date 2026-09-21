import { ReactNode, useEffect } from "react";
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
import { isDialogOpen, useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

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

  // ⇧⌘\ maximizes the PDF — the sibling of ⌘\, the section rail's chord. A mod
  // chord types nothing, so it works while the cursor sits in a form field.
  useKeyboardShortcuts({
    bindings: [{ type: "chord", key: "\\", mod: true, shift: true, handler: pdf.toggleExpanded }],
    enabled: true,
  });

  // Escape leaves the expanded view.
  //
  // CAPTURE, not bubble: the run screens bind Escape to "close the palette"
  // through useKeyboardShortcuts, which calls preventDefault whether or not a
  // palette is open. A bubble listener here registers after that one and would
  // only ever see an already-handled event, so Escape silently did nothing
  // while expanded.
  //
  // Capture would otherwise outrank a dialog, so an open overlay keeps the key:
  // the reviewer's Escape closes the confirm in front of them, not the layout
  // behind it. A second Escape then restores the split.
  const { isExpanded, collapse } = pdf;
  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isDialogOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      collapse();
    };
    window.addEventListener("keydown", onKeyDownCapture, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDownCapture, { capture: true });
  }, [isExpanded, collapse]);

  // Expanded: the PDF is the whole workspace. The form panel and handle leave
  // the tree rather than collapsing to zero width — a zero-width panel keeps
  // its focusable content in the Tab order.
  //
  // The PDF panel itself NEVER leaves. It used to be swapped for a plain div
  // when expanded, which unmounted PrumoPdfViewer: every expand and every
  // restore tore the engine down and re-fetched the file, so the reviewer
  // watched the document reload (and lost page, zoom and search) on a control
  // that only changes the layout. Keeping one keyed <ResizablePanel> across
  // both states makes the toggle a pure resize.
  const maximized = pdf.isOpen && pdf.isExpanded;
  const panels = (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      {/* v4 stamps data-testid={id} on panels (overriding any explicit
          data-testid prop), so the ids ARE the DOM test contract. */}
      {!maximized && (
        <ResizablePanel
          key="form"
          id="assessment-shell-form"
          defaultSize={pdf.isOpen ? "50%" : "100%"}
          minSize="30%"
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
      )}
      {pdf.isOpen && !maximized ? <ResizableHandle key="handle" withHandle /> : null}
      {pdf.isOpen ? (
        <ResizablePanel
          key="pdf"
          id="assessment-shell-pdf"
          defaultSize="50%"
          minSize={maximized ? "100%" : "30%"}
          maxSize={maximized ? "100%" : "70%"}
          // v4 overrides data-testid with the panel id, so the maximized
          // state is exposed as its own attribute instead.
          data-expanded={maximized || undefined}
        >
          {pdfPanel}
        </ResizablePanel>
      ) : null}
    </ResizablePanelGroup>
  );

  return (
    <div className="flex h-full w-full flex-col" data-testid="assessment-shell">
      {/* Maximizing gives the PDF the whole workspace, vertically too: the run
          header and its status strip fold away, and the viewer's own restore
          button (or Escape) brings them back. On a phone-width viewport that
          header is most of the screen. */}
      {header && !maximized ? <div className="shrink-0">{header}</div> : null}
      {subHeader && !maximized ? <div className="shrink-0">{subHeader}</div> : null}
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
