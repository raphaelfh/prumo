import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunSplitShell } from "@/components/runs/RunSplitShell";
import { createViewerStore } from "@/pdf-viewer/core";
import { useReaderLocate } from "@/hooks/extraction/useReaderLocate";

function Probe() {
  const { isAvailable } = useReaderLocate();
  return <div data-testid="probe">{isAvailable ? "avail" : "n/a"}</div>;
}

describe("RunSplitShell", () => {
  it("renders header + form by default; PDF hidden; show button present", () => {
    render(
      <RunSplitShell
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
        header={<div data-testid="header">HEAD</div>}
      />,
    );
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-content")).not.toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-show-pdf")).toBeInTheDocument();
  });

  it("form panel renders before the PDF panel in DOM order (form-left)", () => {
    render(
      <RunSplitShell
        initialPdfOpen
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
      />,
    );
    const form = screen.getByTestId("form-content");
    const pdf = screen.getByTestId("pdf-content");
    // form precedes pdf ⇒ Node.DOCUMENT_POSITION_FOLLOWING (4) is set
    expect(form.compareDocumentPosition(pdf) & 4).toBeTruthy();
  });

  it("renders subHeader between header and panels", () => {
    render(
      <RunSplitShell
        header={<div data-testid="header">HEAD</div>}
        subHeader={<div data-testid="subheader">SUB</div>}
        pdfPanel={<div>PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
      />,
    );
    expect(screen.getByTestId("subheader")).toBeInTheDocument();
  });

  it("wraps panels in a ViewerProvider only when viewerStore is passed", () => {
    const store = createViewerStore();
    const { rerender } = render(
      <RunSplitShell pdfPanel={<div>PDF</div>} formPanel={<Probe />} />,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("n/a");
    rerender(
      <RunSplitShell viewerStore={store} pdfPanel={<div>PDF</div>} formPanel={<Probe />} />,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("avail");
  });

  it("a formPanel inside the shell drives the SAME viewerStore (locate → reader mode)", () => {
    // Proves the shared-store invariant: the form panel resolves the shared store,
    // so an evidence-popover locate() reaches the reader. Default mode is 'canvas';
    // locate() switches it to 'reader'.
    const store = createViewerStore();
    function LocateProbe() {
      const { locate, isAvailable } = useReaderLocate();
      return (
        <button
          data-testid="do-locate"
          disabled={!isAvailable}
          onClick={() => locate("hello", 1, [])}
        >
          go
        </button>
      );
    }
    render(
      <RunSplitShell viewerStore={store} pdfPanel={<div>PDF</div>} formPanel={<LocateProbe />} />,
    );
    expect(store.getState().mode).not.toBe("reader");
    fireEvent.click(screen.getByTestId("do-locate"));
    expect(store.getState().mode).toBe("reader");
  });

  it("Show/Hide PDF toggles the panel when no pdfState is provided", () => {
    render(
      <RunSplitShell
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div>FORM</div>}
      />,
    );
    fireEvent.click(screen.getByTestId("assessment-shell-show-pdf"));
    expect(screen.getByTestId("pdf-content")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("assessment-shell-hide-pdf"));
    expect(screen.queryByTestId("pdf-content")).not.toBeInTheDocument();
  });
});
