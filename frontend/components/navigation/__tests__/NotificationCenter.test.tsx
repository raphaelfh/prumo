/**
 * Regression coverage for NotificationCenter reactivity.
 *
 * Root-cause guard for the async-export "never downloads" incident: a
 * background job added AFTER the component mounted (e.g. the user submits
 * an export) must appear in the bell without a page reload. The original
 * `recentJobs = useMemo(() => getRecentJobs(20), [jobs, getRecentJobs])`
 * never referenced `jobs` inside the callback, so the React Compiler
 * (which derives deps from the body, not the manual array) memoized it on
 * the stable `getRecentJobs` action and never recomputed on new jobs —
 * the bell stayed stale until a reload rehydrated it.
 */

import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, act, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router-dom";

vi.mock("sonner", () => ({
    toast: {success: vi.fn(), info: vi.fn(), error: vi.fn()},
}));
vi.mock("@/services/extractionExportService", () => ({
    getExportStatus: vi.fn().mockResolvedValue({job_id: "x", status: "completed"}),
}));
vi.mock("@/services/articlesExportService", () => ({
    getExportStatus: vi.fn().mockResolvedValue({job_id: "x", status: "completed"}),
}));

import {NotificationCenter} from "../NotificationCenter";
import {useBackgroundJobs} from "@/stores/useBackgroundJobs";
import {createExtractionExportJob} from "@/types/background-jobs";

function completedExportJob(id: string) {
    return {
        ...createExtractionExportJob("11111111-1111-1111-1111-111111111111", `backend-${id}`, {
            templateId: "22222222-2222-2222-2222-222222222222",
            mode: "all_users" as const,
            articleCount: 5,
            includeAiMetadata: false,
            anonymizeReviewerNames: false,
            downloadUrl: "https://example.test/export.xlsx",
        }),
        id,
        status: "completed" as const,
        completedAt: Date.now(),
    };
}

beforeEach(() => {
    act(() => {
        // Fresh slate: no jobs, and lastReadAt=now so nothing reads as unread
        // until a test arranges it.
        useBackgroundJobs.setState({jobs: [], lastReadAt: Date.now()});
    });
});

describe("NotificationCenter", () => {
    it("shows a job added after mount without a reload", async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );

        await user.click(screen.getByRole("button", {name: /notifications/i}));
        expect(screen.getByText(/No notifications/i)).toBeInTheDocument();

        // Simulate the export dialog enqueuing a completed job in-session.
        act(() => {
            useBackgroundJobs.getState().addJob(completedExportJob("job-1"));
        });

        // The bell must reflect it immediately (not only after a reload).
        expect(await screen.findByText("Export extraction data")).toBeInTheDocument();
        expect(screen.queryByText(/No notifications/i)).not.toBeInTheDocument();
    });

    it("announces the unread count, badges it non-destructively, and clears it on open", async () => {
        const user = userEvent.setup();
        // lastReadAt=0 → both finished jobs are unread.
        act(() => {
            useBackgroundJobs.setState({
                lastReadAt: 0,
                jobs: [completedExportJob("job-1"), completedExportJob("job-2")],
            });
        });
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );

        // The count is announced via the trigger's accessible name…
        const bell = screen.getByRole("button", {name: /2 unread/i});
        // …and shown as a NON-destructive (primary) badge that is aria-hidden so
        // it isn't read twice.
        const badge = screen.getByText("2");
        expect(badge).toHaveClass("bg-primary");
        expect(badge).not.toHaveClass("bg-destructive");
        expect(badge).toHaveAttribute("aria-hidden", "true");

        // Opening the bell marks everything read → badge clears.
        await user.click(bell);
        await waitFor(() =>
            expect(useBackgroundJobs.getState().lastReadAt).toBeGreaterThan(0),
        );
        expect(screen.queryByText("2")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", {name: /unread/i})).toBeNull();
    });
});
