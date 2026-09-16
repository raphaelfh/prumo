import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RunSplitShell } from "@/components/runs/RunSplitShell";
import { createViewerStore } from "@/pdf-viewer/core";
import { useReaderLocate } from "@/hooks/extraction/useReaderLocate";
import { usePdfPanel } from "@/hooks/usePdfPanel";
import { useRunShortcuts } from "@/hooks/runs/useRunShortcuts";

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

/**
 * Expanded = the PDF fills the workspace. The form panel and the drag handle
 * unmount rather than shrink to zero: a 0%-wide panel still traps the reviewer's
 * Tab order and still reports a resize to the viewer's fit-width observer.
 */
describe("RunSplitShell expanded", () => {
  /**
   * Mirrors the real screens: the page binds the run shortcuts (whose Escape
   * closes the palette and calls preventDefault unconditionally) and renders
   * the shell beneath it. Without this parent the Escape test is false-green —
   * nothing else competes for the key.
   */
  function ExpandHarness({
    children,
    onClosePalette = () => {},
  }: {
    children?: React.ReactNode;
    onClosePalette?: () => void;
  }) {
    const pdf = usePdfPanel({ initialOpen: true });
    useRunShortcuts({
      articles: [{ id: "a1" }, { id: "a2" }],
      currentArticleId: "a1",
      onNavigateToArticle: () => {},
      onTogglePalette: () => {},
      onClosePalette,
    });
    return (
      <>
        <button type="button" onClick={pdf.toggleExpanded} data-testid="toggle-expand">
          toggle
        </button>
        <RunSplitShell
          pdfState={pdf}
          pdfPanel={<div data-testid="pdf-content">PDF</div>}
          formPanel={<div data-testid="form-content">FORM</div>}
          header={<div data-testid="header">HEAD</div>}
        />
        {children}
      </>
    );
  }

  it("keeps the header while hiding the form pane and the handle", () => {
    render(<ExpandHarness />);
    expect(screen.getByTestId("form-content")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-expand"));

    expect(screen.getByTestId("pdf-content")).toBeInTheDocument();
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.queryByTestId("form-content")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("restores the split on a second toggle", () => {
    render(<ExpandHarness />);
    fireEvent.click(screen.getByTestId("toggle-expand"));
    fireEvent.click(screen.getByTestId("toggle-expand"));
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-content")).toBeInTheDocument();
  });

  it("restores the split on Escape", () => {
    render(<ExpandHarness />);
    fireEvent.click(screen.getByTestId("toggle-expand"));
    expect(screen.queryByTestId("form-content")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByTestId("form-content")).toBeInTheDocument();
  });

  it("toggles on the ⇧mod+\\ chord, the section rail's sibling", () => {
    render(<ExpandHarness />);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true, metaKey: true, shiftKey: true });
    expect(screen.queryByTestId("form-content")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true, metaKey: true, shiftKey: true });
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
  });

  it("ignores the rail's own mod+\\ , which carries no Shift", () => {
    render(<ExpandHarness />);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true, metaKey: true });
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
  });

  it("leaves Escape to the run screen while not expanded", () => {
    const onClosePalette = vi.fn();
    render(<ExpandHarness onClosePalette={onClosePalette} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClosePalette).toHaveBeenCalledTimes(1);
  });

  /** Expanded, the layout owns Escape — the palette must not also swallow it. */
  it("takes Escape from the run screen while expanded", () => {
    const onClosePalette = vi.fn();
    render(<ExpandHarness onClosePalette={onClosePalette} />);
    fireEvent.click(screen.getByTestId("toggle-expand"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClosePalette).not.toHaveBeenCalled();
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
  });

  /** An overlay in front keeps the key: Escape closes that, not the layout. */
  it("yields Escape to an open dialog while expanded", () => {
    render(
      <ExpandHarness>
        <div role="alertdialog">Re-parse this document?</div>
      </ExpandHarness>,
    );
    fireEvent.click(screen.getByTestId("toggle-expand"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("form-content")).not.toBeInTheDocument();
  });
});
