/**
 * The Articles toolbar owns import / export / add.
 *
 * These actions used to live in a separate sticky bar above the list, whose
 * label duplicated the app header. They now sit on the search row, so this
 * covers what that move has to preserve: the three actions exist, they are
 * wired to the parent callbacks, and export stays disabled while there is
 * nothing to export.
 */

import {describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router";
import {ArticlesList} from "@/components/articles/ArticlesList";
import type {Article} from "@/types/article";
import {fetchArticleIdsWithMainFile, fetchArticlePdfSignedUrl} from "@/services/articlesService";

// The component tree reaches `@/integrations/supabase/client`, which builds a
// real client at module scope. CI has no env for it, so the import throws there
// and only there — stub it up front.
vi.mock("@/integrations/supabase/client", () => ({supabase: {}}));

vi.mock("@/services/articlesService", () => ({
    fetchArticleIdsWithMainFile: vi.fn(async () => ({ok: true, data: [] as string[]})),
    fetchArticlePdfSignedUrl: vi.fn(),
    deleteArticle: vi.fn(),
    bulkDeleteArticles: vi.fn(),
}));

vi.mock("@/hooks/useZoteroIntegration", () => ({
    useZoteroIntegration: () => ({isConfigured: true}),
}));

vi.mock("@/components/articles/ArticlesExportDialog", () => ({
    ArticlesExportDialog: ({open}: {open: boolean}) =>
        open ? <div data-testid="export-dialog"/> : null,
}));

const article = (id: string, title: string): Article =>
    ({id, title, project_id: "p1"}) as Article;

function renderList(articles: Article[]) {
    const handlers = {
        onOpenZoteroDialog: vi.fn(),
        onOpenRisDialog: vi.fn(),
        onOpenAddArticle: vi.fn(),
        onArticlesChange: vi.fn(),
        onArticleClick: vi.fn(),
    };
    render(
        <MemoryRouter>
            <ArticlesList
                articles={articles}
                projectId="p1"
                {...handlers}
            />
        </MemoryRouter>,
    );
    return handlers;
}

describe("ArticlesList toolbar", () => {
    it("opens the article editor from the toolbar add action", async () => {
        const handlers = renderList([article("a1", "First")]);

        await userEvent.click(screen.getByRole("button", {name: "Add article"}));

        expect(handlers.onOpenAddArticle).toHaveBeenCalledTimes(1);
    });

    it("offers both import sources behind the toolbar import action", async () => {
        const handlers = renderList([article("a1", "First")]);

        await userEvent.click(screen.getByRole("button", {name: "Import"}));
        await userEvent.click(await screen.findByText("From RIS file"));
        expect(handlers.onOpenRisDialog).toHaveBeenCalledTimes(1);

        await userEvent.click(screen.getByRole("button", {name: "Import"}));
        await userEvent.click(await screen.findByText("From Zotero"));
        expect(handlers.onOpenZoteroDialog).toHaveBeenCalledTimes(1);
    });

    it("keeps export disabled while there is nothing to export", () => {
        renderList([]);
        expect(screen.getByRole("button", {name: "Export"})).toBeDisabled();
    });

    it("exports the current list", async () => {
        renderList([article("a1", "First")]);

        const exportButton = screen.getByRole("button", {name: "Export"});
        expect(exportButton).toBeEnabled();
        await userEvent.click(exportButton);

        expect(await screen.findByTestId("export-dialog")).toBeInTheDocument();
    });
});

describe("ArticlesList title cell", () => {
    it("opens the article from the keyboard through a button named by its title", async () => {
        const user = userEvent.setup();
        const handlers = renderList([article("a1", "First")]);

        const title = screen.getByRole("button", {name: "First"});
        // The cell keeps its name (the E2E flow finds the row's cell by it), and
        // the control holds only the title — no nested interactive element.
        expect(title.closest("td")).toHaveAccessibleName("First");
        expect(title.querySelector("button, input, a")).toBeNull();

        title.focus();
        await user.keyboard("{Enter}");

        expect(handlers.onArticleClick).toHaveBeenCalledWith("a1");
    });
});

describe("ArticlesList column resize", () => {
    it("resizes a column from the keyboard through a separator named by its column", async () => {
        const user = userEvent.setup();
        renderList([article("a1", "First")]);

        const handle = screen.getByRole("separator", {name: "Resize Title column"});
        const before = Number(handle.getAttribute("aria-valuenow"));

        handle.focus();
        await user.keyboard("{ArrowRight}");

        expect(handle).toHaveAttribute("aria-valuenow", String(before + 16));
    });
});

describe("ArticlesList PDF chip", () => {
    it("opens the main PDF from the keyboard", async () => {
        const user = userEvent.setup();
        const open = vi.spyOn(window, "open").mockImplementation(() => null);
        vi.mocked(fetchArticleIdsWithMainFile).mockResolvedValue({ok: true, data: ["a1"]});
        vi.mocked(fetchArticlePdfSignedUrl).mockResolvedValue({ok: true, data: "https://example.test/a1.pdf"});
        renderList([article("a1", "First")]);

        const chip = await screen.findByRole("button", {name: "Open PDF"});
        chip.focus();
        await user.keyboard("{Enter}");

        await vi.waitFor(() => expect(open).toHaveBeenCalledWith("https://example.test/a1.pdf", "_blank"));
        open.mockRestore();
    });
});
