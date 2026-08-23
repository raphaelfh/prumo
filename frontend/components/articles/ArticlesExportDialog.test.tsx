/**
 * Vitest coverage for ArticlesExportDialog: the sync and async submit
 * branches, the article-scope wiring, and the empty-scope guard.
 */

import {describe, it, expect, vi, beforeEach} from "vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ArticlesExportDialog} from "./ArticlesExportDialog";

// ---- Mocks (hoisted so vi.mock factories can reference them) ----------

const {startExportMock, addJobMock, triggerDownloadMock, toastSuccess, toastInfo} =
    vi.hoisted(() => ({
        startExportMock: vi.fn(),
        addJobMock: vi.fn(),
        triggerDownloadMock: vi.fn(),
        toastSuccess: vi.fn(),
        toastInfo: vi.fn(),
    }));

vi.mock("@/services/articlesExportService", () => ({
    startExport: (...args: unknown[]) => startExportMock(...args),
}));

vi.mock("@/stores/useBackgroundJobs", () => ({
    useBackgroundJobs: () => ({addJob: addJobMock}),
}));

// The point of the consolidation: the dialog delegates to the shared helper
// rather than hand-rolling an anchor. lib/download.test.ts covers the helper.
vi.mock("@/lib/download", () => ({
    triggerDownload: (...args: unknown[]) => triggerDownloadMock(...args),
}));

vi.mock("sonner", () => ({
    toast: {success: toastSuccess, info: toastInfo, error: vi.fn()},
}));

beforeEach(() => {
    vi.resetAllMocks();
});

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function renderDialog(
    overrides: Partial<React.ComponentProps<typeof ArticlesExportDialog>> = {},
) {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
        <ArticlesExportDialog
            open
            onOpenChange={onOpenChange}
            projectId={PROJECT_ID}
            currentListIds={["a1", "a2", "a3"]}
            selectedIds={["a2"]}
            {...overrides}
        />,
    );
    return {onOpenChange, user};
}

const submitButton = () => screen.getByRole("button", {name: "Export"});

describe("ArticlesExportDialog", () => {
    it("hands the blob to the shared download helper on a sync response", async () => {
        const blob = new Blob(["id,title"], {type: "text/csv"});
        startExportMock.mockResolvedValueOnce({
            kind: "sync",
            blob,
            filename: "articles_20260823.csv",
        });
        const {onOpenChange, user} = renderDialog();

        await user.click(submitButton());

        await waitFor(() => expect(triggerDownloadMock).toHaveBeenCalledTimes(1));
        expect(triggerDownloadMock).toHaveBeenCalledWith(blob, "articles_20260823.csv");
        expect(startExportMock).toHaveBeenCalledWith(PROJECT_ID, ["a1", "a2", "a3"], ["csv"], "none");
        // The sync branch downloads, toasts and closes in one synchronous run.
        expect(toastSuccess).toHaveBeenCalled();
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("dispatches a background job and downloads nothing on an async response", async () => {
        startExportMock.mockResolvedValueOnce({kind: "async", job_id: "celery-job-id"});
        const {user} = renderDialog();

        await user.click(submitButton());

        await waitFor(() => expect(addJobMock).toHaveBeenCalledTimes(1));
        expect(addJobMock.mock.calls[0][0]).toMatchObject({
            type: "articles-export",
            metadata: {backendJobId: "celery-job-id"},
        });
        expect(triggerDownloadMock).not.toHaveBeenCalled();
        expect(toastInfo).toHaveBeenCalled();
    });

    it("disables submit when the default scope holds no articles", () => {
        renderDialog({currentListIds: [], selectedIds: []});

        expect(submitButton()).toBeDisabled();
    });

    it("sends the selected ids when the 'selected' scope is picked", async () => {
        startExportMock.mockResolvedValueOnce({kind: "async", job_id: "job"});
        const {user} = renderDialog({defaultArticleScope: "selected"});

        await user.click(submitButton());

        await waitFor(() =>
            expect(startExportMock).toHaveBeenCalledWith(PROJECT_ID, ["a2"], ["csv"], "none"),
        );
    });
});
