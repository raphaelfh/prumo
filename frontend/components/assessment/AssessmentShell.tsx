import { ReactNode } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { usePdfPanel } from "@/hooks/usePdfPanel";

export interface AssessmentShellProps {
  /** PDF viewer content for the left panel. */
  pdfPanel: ReactNode;
  /** Form / evaluation content for the right panel. */
  formPanel: ReactNode;
  /** Optional sticky header above the panels. */
  header?: ReactNode;
  /** When true, the PDF panel starts open. Default false (collapsed). */
  initialPdfOpen?: boolean;
}

/**
 * Shared layout for extraction + (future) quality-assessment screens.
 * Keeps the PDF panel collapsed by default; user can show via the toggle.
 */
export function AssessmentShell({
  pdfPanel,
  formPanel,
  header,
  initialPdfOpen = false,
}: AssessmentShellProps) {
  const pdf = usePdfPanel({ initialOpen: initialPdfOpen });
  return (
    <div
      className="flex h-full w-full flex-col"
      data-testid="assessment-shell"
    >
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {pdf.isOpen ? (
            <>
              <ResizablePanel
                defaultSize={50}
                minSize={30}
                data-testid="assessment-shell-pdf"
              >
                {pdfPanel}
              </ResizablePanel>
              <ResizableHandle />
            </>
          ) : null}
          <ResizablePanel
            defaultSize={pdf.isOpen ? 50 : 100}
            minSize={30}
            data-testid="assessment-shell-form"
          >
            <div className="flex h-full flex-col">
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
              <div className="min-h-0 flex-1 overflow-auto">{formPanel}</div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
