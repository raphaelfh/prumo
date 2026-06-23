/**
 * Tests for DocumentSwitcher (presentational document selector) and
 * ParseStatusControl (status-aware re-parse control).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));
vi.mock("@/services/articlesService", () => ({ reparseArticleFile: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copy", () => ({ t: (_n: string, k: string) => k }));

import { apiClient } from "@/integrations/api";
import { DocumentSwitcher, ParseStatusControl } from "@/components/extraction/DocumentSwitcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ArticleFileListItem } from "@/services/articleFilesService";

function file(
  id: string,
  fileRole: string,
  originalFilename: string,
  extractionStatus = "parsed",
): ArticleFileListItem {
  return {
    id,
    fileRole,
    fileType: "PDF",
    originalFilename,
    extractionStatus,
    bytes: 1,
    storageKey: `k/${id}.pdf`,
    createdAt: "2026-06-21T00:00:00Z",
  };
}

function renderControl(f: { id: string; extractionStatus: string; extractionError?: string | null }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ParseStatusControl
          articleId="art-1"
          file={{ originalFilename: "a.pdf", fileRole: "MAIN", ...f } as never}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("DocumentSwitcher", () => {
  it("renders nothing when there are no files", () => {
    const { container } = render(
      <DocumentSwitcher files={[]} selectedFileId={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the selected file label in the trigger", () => {
    const files = [
      file("main-1", "MAIN", "main.pdf"),
      file("supp-1", "SUPPLEMENT", "supp.pdf", "pending"),
    ];
    render(
      <DocumentSwitcher
        files={files}
        selectedFileId="main-1"
        onSelect={() => {}}
      />,
    );
    // The trigger renders the selected file's label explicitly (not via the
    // unmounted Radix item list).
    expect(screen.getByText("main.pdf")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-label",
      "docSwitcherAria",
    );
  });
});

describe("ParseStatusControl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("failed: shows the error in a tooltip trigger and a Retry that POSTs", async () => {
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderControl({ id: "f1", extractionStatus: "parse_failed", extractionError: "libxcb.so.1 missing" });
    fireEvent.click(screen.getByRole("button", { name: /docReparse/ }));
    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith("/api/v1/article-files/f1/reparse", { method: "POST" });
    });
  });

  it("parsed: Re-parse opens a confirm dialog before POSTing", async () => {
    const user = userEvent.setup();
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderControl({ id: "f2", extractionStatus: "parsed" });
    await user.click(screen.getByRole("button", { name: /docReparse/ }));
    expect(apiClient).not.toHaveBeenCalled();             // confirm first
    const confirmBtn = await screen.findByRole("button", { name: /docReparseConfirmCta/ });
    await user.click(confirmBtn);
    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith("/api/v1/article-files/f2/reparse", { method: "POST" });
    });
  });

  it("pending: shows Processing and a Retry", () => {
    renderControl({ id: "f3", extractionStatus: "pending" });
    expect(screen.getByText("docStatusPending")).toBeInTheDocument();
  });
});
