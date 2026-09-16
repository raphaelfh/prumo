/**
 * Tests for DocumentSwitcher (presentational document selector) and the
 * status-aware re-parse control that lives in the viewer's ☰ menu.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/api", () => ({ apiClient: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copy", () => ({ t: (_n: string, k: string) => k }));

import { apiClient } from "@/integrations/api";
import {
  DocumentSwitcher,
  ParseStatusMenuItem,
  ParseStatusOverlay,
  useParseStatus,
} from "@/components/extraction/DocumentSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * Mirrors the real composition: the item lives inside the ☰ menu, the confirm
 * dialog and the live region live OUTSIDE it, so closing the menu cannot
 * unmount either.
 */
function Harness({ f }: { f: { id: string; extractionStatus: string; extractionError?: string | null } }) {
  const control = useParseStatus("art-1", {
    originalFilename: "a.pdf",
    fileRole: "MAIN",
    ...f,
  } as never);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ParseStatusMenuItem control={control} />
        </DropdownMenuContent>
      </DropdownMenu>
      <ParseStatusOverlay control={control} />
    </>
  );
}

function renderControl(f: { id: string; extractionStatus: string; extractionError?: string | null }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <Harness f={f} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Opens the ☰ menu so its items are in the tree. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("menu"));
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

describe("ParseStatusMenuItem", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parsed: the item carries the status and what re-parsing does, no hover needed", async () => {
    const user = userEvent.setup();
    renderControl({ id: "f5", extractionStatus: "parsed" });
    await openMenu(user);
    const item = await screen.findByRole("menuitem");
    expect(item).toHaveTextContent("docStatusReady");
    expect(item).toHaveTextContent("docReparseHint");
  });

  it("failed: the item carries the parse error", async () => {
    const user = userEvent.setup();
    renderControl({
      id: "f1",
      extractionStatus: "parse_failed",
      extractionError: "libxcb.so.1 missing",
    });
    await openMenu(user);
    const item = await screen.findByRole("menuitem");
    expect(item).toHaveTextContent("libxcb.so.1 missing");
  });

  it("failed: selecting retries straight away", async () => {
    const user = userEvent.setup();
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderControl({ id: "f1", extractionStatus: "parse_failed" });
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem"));
    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith("/api/v1/article-files/f1/reparse", { method: "POST" });
    });
  });

  it("parsed: selecting confirms first, and the dialog outlives the closing menu", async () => {
    const user = userEvent.setup();
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderControl({ id: "f2", extractionStatus: "parsed" });
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem"));
    expect(apiClient).not.toHaveBeenCalled();

    // The menu has closed; the confirm must still be here (it is rendered
    // outside DropdownMenuContent, which unmounts its children on close).
    await waitFor(() => expect(screen.queryByRole("menuitem")).not.toBeInTheDocument());
    const confirmBtn = await screen.findByRole("button", { name: /docReparseConfirmCta/ });
    await user.click(confirmBtn);
    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith("/api/v1/article-files/f2/reparse", { method: "POST" });
    });
  });

  it("pending: selecting retries", async () => {
    const user = userEvent.setup();
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderControl({ id: "f4", extractionStatus: "pending" });
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem"));
    await waitFor(() => {
      expect(apiClient).toHaveBeenCalledWith("/api/v1/article-files/f4/reparse", { method: "POST" });
    });
  });

  /**
   * The status used to be an always-visible toolbar button. Now that it lives
   * in a menu, the live region is what keeps the change audible — so it must
   * NOT be inside the menu.
   */
  it("announces the status while the menu is closed", () => {
    renderControl({ id: "f3", extractionStatus: "pending" });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("docStatusPending");
  });

  it("renders nothing for an unknown status", async () => {
    const user = userEvent.setup();
    renderControl({ id: "f6", extractionStatus: "whatever" });
    await openMenu(user);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
