/**
 * Deleting articles is manager-only on the server (RLS and the API's 403),
 * so the list shows Delete controls to managers alone and routes every delete
 * through the API, which removes the rows before their PDFs.
 */

import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router";
import {toast} from "sonner";
import {ArticlesList} from "@/components/articles/ArticlesList";
import type {Article} from "@/types/article";

vi.mock("@/integrations/supabase/client", () => ({supabase: {}}));

vi.mock("@/services/articlesService", () => ({
    fetchArticleIdsWithMainFile: vi.fn(async () => ({ok: true, data: [] as string[]})),
    fetchArticlePdfSignedUrl: vi.fn(),
}));

vi.mock("@/services/articleListService", () => ({
    deleteArticles: vi.fn(),
}));

vi.mock("@/hooks/useZoteroIntegration", () => ({
    useZoteroIntegration: () => ({isConfigured: true}),
}));

vi.mock("@/hooks/useProjectMemberRole", () => ({
    useProjectMemberRole: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: {success: vi.fn(), error: vi.fn(), info: vi.fn()},
}));

import {deleteArticles} from "@/services/articleListService";
import {useProjectMemberRole} from "@/hooks/useProjectMemberRole";

const article = (id: string, title: string): Article =>
    ({id, title, project_id: "p1"}) as Article;

const articles = [article("a1", "First"), article("a2", "Second")];

function asRole(isManager: boolean, loading = false) {
    vi.mocked(useProjectMemberRole).mockReturnValue({
        role: isManager ? "manager" : "reviewer",
        isManager,
        loading,
    });
}

function renderList() {
    const onArticlesChange = vi.fn();
    render(
        <MemoryRouter>
            <ArticlesList
                articles={articles}
                onArticleClick={vi.fn()}
                projectId="p1"
                onOpenZoteroDialog={vi.fn()}
                onOpenRisDialog={vi.fn()}
                onOpenAddArticle={vi.fn()}
                onArticlesChange={onArticlesChange}
            />
        </MemoryRouter>,
    );
    return {onArticlesChange};
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
    const [firstRowActions] = await screen.findAllByRole("button", {name: "Article actions"});
    await user.click(firstRowActions);
    // The menu is portalled; wait for its always-present item.
    await screen.findByRole("menuitem", {name: /Attach file/});
}

describe("ArticlesList delete gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("hides every Delete control from a non-manager", async () => {
        asRole(false);
        const user = userEvent.setup();
        renderList();

        await openRowMenu(user);
        expect(screen.queryByRole("menuitem", {name: "Delete"})).toBeNull();
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("checkbox", {name: /First/}));
        expect(screen.getByText(/1 selected/)).toBeTruthy();
        expect(screen.queryByRole("button", {name: "Delete"})).toBeNull();
    });

    it("hides Delete controls while the role is still loading", async () => {
        asRole(false, true);
        const user = userEvent.setup();
        renderList();

        await openRowMenu(user);
        expect(screen.queryByRole("menuitem", {name: "Delete"})).toBeNull();
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("checkbox", {name: /First/}));
        expect(screen.queryByRole("button", {name: "Delete"})).toBeNull();
    });

    it("bulk-deletes the selection through the API and reports the server's count", async () => {
        asRole(true);
        vi.mocked(deleteArticles).mockResolvedValue({ok: true, data: {deleted: 2, storage_failures: 0}});
        const user = userEvent.setup();
        const {onArticlesChange} = renderList();

        await user.click(screen.getByRole("checkbox", {name: /First/}));
        await user.click(screen.getByRole("checkbox", {name: /Second/}));
        await user.click(screen.getByRole("button", {name: "Delete"}));
        const dialog = await screen.findByRole("alertdialog");
        await user.click(within(dialog).getByRole("button", {name: /Delete 2 article/}));

        await vi.waitFor(() => expect(onArticlesChange).toHaveBeenCalledTimes(1));
        expect(deleteArticles).toHaveBeenCalledWith("p1", {mode: "ids", ids: ["a1", "a2"]});
        expect(toast.success).toHaveBeenCalledWith("2 article(s) deleted successfully!");
        expect(screen.queryByText(/selected/)).toBeNull();
    });

    it("deletes one article from its row menu through the API", async () => {
        asRole(true);
        vi.mocked(deleteArticles).mockResolvedValue({ok: true, data: {deleted: 1, storage_failures: 0}});
        const user = userEvent.setup();
        const {onArticlesChange} = renderList();

        await openRowMenu(user);
        await user.click(await screen.findByRole("menuitem", {name: "Delete"}));
        const dialog = await screen.findByRole("alertdialog");
        await user.click(within(dialog).getByRole("button", {name: "Delete"}));

        await vi.waitFor(() => expect(onArticlesChange).toHaveBeenCalledTimes(1));
        expect(deleteArticles).toHaveBeenCalledWith("p1", {mode: "ids", ids: ["a1"]});
        expect(toast.success).toHaveBeenCalledWith("Article deleted successfully!");
    });

    it("keeps the selection and skips the refresh when the API refuses", async () => {
        asRole(true);
        vi.mocked(deleteArticles).mockResolvedValue({
            ok: false,
            error: {message: "Only managers can delete articles"},
        } as Awaited<ReturnType<typeof deleteArticles>>);
        const user = userEvent.setup();
        const {onArticlesChange} = renderList();

        await user.click(screen.getByRole("checkbox", {name: /First/}));
        await user.click(screen.getByRole("button", {name: "Delete"}));
        const dialog = await screen.findByRole("alertdialog");
        await user.click(within(dialog).getByRole("button", {name: /Delete 1 article/}));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
        expect(onArticlesChange).not.toHaveBeenCalled();
        expect(screen.getByText(/1 selected/)).toBeTruthy();
    });
});
