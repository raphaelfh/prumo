/**
 * The title cell and the PDF chip are click targets with no ARIA role and
 * no `<label>`/`<summary>` wrapper (see task-10 fix round 1): after their
 * `cursor-pointer` utility was deleted, the base-layer arrow-cursor rule
 * (`[role="button"], …, label, summary { cursor: default }`) does not match
 * either, so they fell through to the text I-beam. Both are now native
 * `<button>` elements — this guards that they keep working as real controls
 * (named, clickable, keyboard-reachable) rather than plain divs again.
 */

import {describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router";
import {ArticlesList} from "@/components/articles/ArticlesList";
import type {Article} from "@/types/article";

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

import {fetchArticleIdsWithMainFile, fetchArticlePdfSignedUrl} from "@/services/articlesService";

const article = (id: string, title: string): Article =>
    ({id, title, project_id: "p1"}) as Article;

function renderList(articles: Article[], onArticleClick = vi.fn()) {
    render(
        <MemoryRouter>
            <ArticlesList
                articles={articles}
                onArticleClick={onArticleClick}
                projectId="p1"
                onOpenZoteroDialog={vi.fn()}
                onOpenRisDialog={vi.fn()}
                onOpenAddArticle={vi.fn()}
                onArticlesChange={vi.fn()}
            />
        </MemoryRouter>,
    );
    return {onArticleClick};
}

describe("ArticlesList row controls", () => {
    it("renders the title as a button named by the article title, and clicking it calls onArticleClick", async () => {
        const user = userEvent.setup();
        const {onArticleClick} = renderList([article("a1", "First article")]);

        const titleButton = await screen.findByRole("button", {name: "First article"});
        await user.click(titleButton);

        expect(onArticleClick).toHaveBeenCalledWith("a1");
    });

    it("renders the PDF chip as a button", async () => {
        vi.mocked(fetchArticleIdsWithMainFile).mockResolvedValueOnce({ok: true, data: ["a1"]});
        vi.mocked(fetchArticlePdfSignedUrl).mockResolvedValueOnce({ok: true, data: "https://example.test/a1.pdf"});
        const user = userEvent.setup();
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

        renderList([article("a1", "First article")]);

        const pdfButton = await screen.findByRole("button", {name: "PDF"});
        await user.click(pdfButton);

        expect(openSpy).toHaveBeenCalledWith("https://example.test/a1.pdf", "_blank");
        openSpy.mockRestore();
    });
});
