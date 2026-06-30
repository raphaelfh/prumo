import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunProvenanceDisclosure } from "@/components/extraction/ai/shared/RunProvenanceDisclosure";

const prov = {
  ranByName: "Raphael F.", provider: "anthropic", model: "claude-sonnet-4-6",
  temperature: 0.1, outputRetries: 2, timeoutSeconds: 120,
  tokensTotal: 3910, strategy: "PROBAST signaling", promptVersion: "v4",
  promptText: "You are appraising risk of bias…", futureKnob: "xyz",
};

describe("RunProvenanceDisclosure", () => {
  it("shows known fields, a generic row for unknown keys, omits absent, expands code", () => {
    render(<RunProvenanceDisclosure provenance={prov} defaultOpen />);
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("120s")).toBeInTheDocument();           // formatter
    expect(screen.getByText(/futureKnob/i)).toBeInTheDocument();    // generic fallback for unknown key
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument(); // absent key omitted
    expect(screen.getByText(/You are appraising/)).toBeInTheDocument(); // code block
  });

  it("collapses by default and toggles", () => {
    render(<RunProvenanceDisclosure provenance={prov} />);
    expect(screen.queryByText("Temperature")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /how this was generated/i }));
    expect(screen.getByText("Temperature")).toBeInTheDocument();
  });

  it("renders the resolved 'Ran by' name row", () => {
    render(<RunProvenanceDisclosure provenance={prov} defaultOpen />);
    expect(screen.getByText("Ran by")).toBeInTheDocument();
    expect(screen.getByText("Raphael F.")).toBeInTheDocument();
  });

  it("omits the 'Ran by' row when no ranByName resolved (only a raw id)", () => {
    render(
      <RunProvenanceDisclosure
        provenance={{ ranByUserId: "uuid-secret", model: "m" }}
        defaultOpen
      />,
    );
    expect(screen.queryByText("Ran by")).not.toBeInTheDocument();
  });

  it("does not leak the raw ranByUserId as a generic row", () => {
    render(
      <RunProvenanceDisclosure
        provenance={{ ranByUserId: "uuid-secret", model: "m" }}
        defaultOpen
      />,
    );
    expect(screen.queryByText(/ranByUserId/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/uuid-secret/)).not.toBeInTheDocument();
  });
});
