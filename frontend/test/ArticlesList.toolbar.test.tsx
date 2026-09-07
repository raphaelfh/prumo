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
    };
    render(
        <MemoryRouter>
            <ArticlesList
                articles={articles}
                onArticleClick={vi.fn()}
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
