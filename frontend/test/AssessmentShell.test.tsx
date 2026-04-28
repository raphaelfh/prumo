import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssessmentShell } from "@/components/assessment/AssessmentShell";

describe("AssessmentShell", () => {
  function renderShell(opts?: { initialPdfOpen?: boolean }) {
    return render(
      <AssessmentShell
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
        header={<div data-testid="header">HEAD</div>}
        initialPdfOpen={opts?.initialPdfOpen}
      />,
    );
  }

  it("renders header + form by default; PDF hidden", () => {
    renderShell();
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-content")).not.toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-show-pdf")).toBeInTheDocument();
  });

  it("Show PDF button reveals PDF panel and switches to Hide PDF", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("assessment-shell-show-pdf"));
    expect(screen.getByTestId("pdf-content")).toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-hide-pdf")).toBeInTheDocument();
  });

  it("Hide PDF button collapses the panel again", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("assessment-shell-show-pdf"));
    fireEvent.click(screen.getByTestId("assessment-shell-hide-pdf"));
    expect(screen.queryByTestId("pdf-content")).not.toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-show-pdf")).toBeInTheDocument();
  });

  it("initialPdfOpen=true opens PDF immediately", () => {
    renderShell({ initialPdfOpen: true });
    expect(screen.getByTestId("pdf-content")).toBeInTheDocument();
    expect(screen.getByTestId("assessment-shell-hide-pdf")).toBeInTheDocument();
  });

  it("form is always visible regardless of PDF state", () => {
    const { rerender } = renderShell();
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("assessment-shell-show-pdf"));
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
    rerender(
      <AssessmentShell
        pdfPanel={<div data-testid="pdf-content">PDF</div>}
        formPanel={<div data-testid="form-content">FORM</div>}
        initialPdfOpen={true}
      />,
    );
    expect(screen.getByTestId("form-content")).toBeInTheDocument();
  });
});
