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
import {MemoryRouter} from "react-router";

vi.mock("sonner", () => ({
    toast: {success: vi.fn(), info: vi.fn(), error: vi.fn()},
}));
vi.mock("@/services/extractionExportService", () => ({
    getExportStatus: vi.fn().mockResolvedValue({job_id: "x", status: "completed"}),
}));
vi.mock("@/services/articlesExportService", () => ({
    getExportStatus: vi.fn().mockResolvedValue({job_id: "x", status: "completed"}),
}));
vi.mock("@/hooks/useAiBatchJobSync", () => ({
    useAiBatchJobSync: vi.fn(),
}));
vi.mock("@/hooks/extraction/useExtractionBatches", () => ({
    useCancelBatch: () => ({mutate: vi.fn(), isPending: false}),
    useBatchDetail: () => ({data: undefined}),
}));
vi.mock("@/components/extraction/batch/BatchDetailsSheet", () => ({
    BatchDetailsSheet: () => null,
}));

import {NotificationCenter} from "../NotificationCenter";
import {useBackgroundJobs} from "@/stores/useBackgroundJobs";
import {createExtractionExportJob} from "@/types/background-jobs";
import {getExportStatus as getExtractionExportStatus} from "@/services/extractionExportService";
import {toast} from "sonner";
import type {AiBatchJob} from "@/types/background-jobs";
import type {ExtractionExportStatus} from "@/types/extraction-export";

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

function runningExportJobWithoutTemplateName(id: string) {
    return {
        ...createExtractionExportJob("11111111-1111-1111-1111-111111111111", `backend-${id}`, {
            // `templateName` is genuinely optional: the dialog fills it from
            // `templates.find(...)?.name`, which is undefined when the template
            // is not in the loaded list.
            templateId: "22222222-2222-2222-2222-222222222222",
            mode: "all_users" as const,
            articleCount: 5,
            includeAiMetadata: false,
            anonymizeReviewerNames: false,
        }),
        id,
        status: "running" as const,
    };
}

function aiBatchJob(metadata: Partial<AiBatchJob["metadata"]> = {}, status: AiBatchJob["status"] = "failed"): AiBatchJob {
    return {
        id: "ai-batch-b1",
        type: "ai-batch",
        status,
        createdAt: Date.now(),
        completedAt: status === "running" ? undefined : Date.now(),
        metadata: {
            batchId: "b1",
            projectId: "p1",
            projectName: "Project 1",
            templateId: "t1",
            templateName: "CHARMS",
            kind: "extraction",
            state: status === "running" ? "active" : "stopped",
            stalled: false,
            stopCode: null,
            counts: {
                done: 1, done_with_issues: 0, needs_attention: 0, not_run: 1,
                queued: 0, running: 0, skipped: 0, total: 2,
            },
            startedByAgent: false,
            agentTokenName: null,
            ...metadata,
        },
    };
}

async function openBellWith(job: AiBatchJob) {
    const user = userEvent.setup();
    act(() => {
        useBackgroundJobs.setState({jobs: [job], lastReadAt: Date.now()});
    });
    render(
        <MemoryRouter>
            <NotificationCenter />
        </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", {name: /notifications/i}));
}

beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    // The bell polls every in-flight export job on mount. Re-establish the
    // default terminal result each time so a per-test override cannot leak.
    vi.mocked(getExtractionExportStatus).mockResolvedValue({
        job_id: "x",
        status: "completed",
    });
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
        expect(await screen.findByText("Export to Excel")).toBeInTheDocument();
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

    it("opens a finished job from the keyboard, without nesting its remove button", async () => {
        const user = userEvent.setup();
        const open = vi.spyOn(window, "open").mockImplementation(() => null);
        act(() => {
            useBackgroundJobs.setState({jobs: [completedExportJob("job-1")], lastReadAt: Date.now()});
        });
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );

        await user.click(screen.getByRole("button", {name: /notifications/i}));
        // Radix menus swallow Tab, so the only keyboard path into an item is a
        // real menuitem reached with the arrow keys.
        const item = await screen.findByRole("menuitem", {name: "Export to Excel"});
        // The remove button is a sibling of the stretched control, never a child.
        expect(item.querySelector("button")).toBeNull();

        await user.keyboard("{ArrowDown}");
        expect(item).toHaveFocus();
        await user.keyboard("{Enter}");

        expect(open).toHaveBeenCalledWith("https://example.test/export.xlsx", "_blank", "noopener,noreferrer");
        open.mockRestore();
    });

    it("exposes a clickable job as a menuitem named by its title, and clicking it fires the click handler", async () => {
        const user = userEvent.setup();
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        act(() => {
            useBackgroundJobs.setState({
                jobs: [completedExportJob("job-1")],
                lastReadAt: Date.now(),
            });
        });
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );

        await user.click(screen.getByRole("button", {name: /notifications/i}));

        // A menuitem, not a button: see the keyboard test above.
        const jobItem = await screen.findByRole("menuitem", {name: "Export to Excel"});
        await user.click(jobItem);

        expect(openSpy).toHaveBeenCalledWith("https://example.test/export.xlsx", "_blank", "noopener,noreferrer");
        openSpy.mockRestore();
    });

    it("dismisses a job without firing the click handler", async () => {
        const user = userEvent.setup();
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        act(() => {
            useBackgroundJobs.setState({
                jobs: [completedExportJob("job-1")],
                lastReadAt: Date.now(),
            });
        });
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );

        await user.click(screen.getByRole("button", {name: /notifications/i}));
        await user.click(screen.getByRole("button", {name: /dismiss/i}));

        expect(useBackgroundJobs.getState().jobs).toHaveLength(0);
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });

    it("names a generic template noun when the job carries no template name", async () => {
        const user = userEvent.setup();
        // Hold the job in-flight: the trailing template slot is only rendered
        // while the export is still generating.
        const stillRunning: ExtractionExportStatus = {job_id: "x", status: "running"};
        vi.mocked(getExtractionExportStatus).mockResolvedValue(stillRunning);
        act(() => {
            useBackgroundJobs.setState({
                jobs: [runningExportJobWithoutTemplateName("job-1")],
                lastReadAt: Date.now(),
            });
        });
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );

        await user.click(screen.getByRole("button", {name: /notifications/i}));

        // The trailing slot names the TEMPLATE being exported, so an absent name
        // must degrade to a generic noun — never to the export dialog's own
        // title, which reads as nonsense in this sentence.
        expect(
            await screen.findByText("Generating… (5 articles, Template)"),
        ).toBeInTheDocument();
    });
});

describe("NotificationCenter — AI batch origin and stop reason", () => {
    it("labels an agent-started batch with its token name", async () => {
        await openBellWith(aiBatchJob({startedByAgent: true, agentTokenName: "CLI token"}));
        expect(await screen.findByText("Started by agent · CLI token")).toBeInTheDocument();
    });

    it("labels an agent-started batch whose token name is gone without a name", async () => {
        await openBellWith(aiBatchJob({startedByAgent: true, agentTokenName: null}));
        expect(await screen.findByText("Started by agent")).toBeInTheDocument();
    });

    it("renders a token name literally, replacement patterns included", async () => {
        await openBellWith(aiBatchJob({startedByAgent: true, agentTokenName: "<b>x</b> $& $1"}));
        expect(await screen.findByText("Started by agent · <b>x</b> $& $1")).toBeInTheDocument();
    });

    it("shows no agent label on a batch started in the app", async () => {
        await openBellWith(aiBatchJob());
        await screen.findByText("Project 1");
        expect(screen.queryByText(/Started by agent/)).not.toBeInTheDocument();
    });

    it.each([
        ["MISSING_API_KEY", "Stopped: the AI engine has no API key"],
        ["ENGINE_RETIRED", "Stopped: the AI engine is no longer available"],
        ["LLM_ENDPOINT_UNAVAILABLE", "Stopped: the AI endpoint could not be reached"],
        ["AGENT_TOKEN_INACTIVE", "Stopped: the agent's access token was revoked or expired"],
        ["AGENT_RUNS_DISABLED", "Stopped: agent-started runs were turned off for this project"],
        ["AGENT_ENGINE_CHANGED", "Stopped: the project's AI engine changed after approval"],
    ])("explains stop code %s in its own words", async (code, message) => {
        await openBellWith(aiBatchJob({stopCode: code}));
        expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it("never shows an unknown stop code's raw text", async () => {
        await openBellWith(aiBatchJob({stopCode: "SOMETHING_NEW"}));
        expect(await screen.findByText("Unavailable")).toBeInTheDocument();
        expect(screen.queryByText(/SOMETHING_NEW/)).not.toBeInTheDocument();
    });

    it("toasts an agent stop with its reason and no engine action", async () => {
        act(() => {
            useBackgroundJobs.setState({jobs: [aiBatchJob({}, "running")], lastReadAt: Date.now()});
        });
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );
        act(() => {
            useBackgroundJobs.getState().updateJob("ai-batch-b1", aiBatchJob({stopCode: "AGENT_TOKEN_INACTIVE"}));
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        const [message, options] = vi.mocked(toast.error).mock.calls[0];
        expect(message).toBe("Stopped: the agent's access token was revoked or expired");
        expect((options as {action?: unknown} | undefined)?.action).toBeUndefined();
    });

    it("toasts an engine stop with its reason and the engine settings action", async () => {
        act(() => {
            useBackgroundJobs.setState({jobs: [aiBatchJob({}, "running")], lastReadAt: Date.now()});
        });
        render(
            <MemoryRouter>
                <NotificationCenter />
            </MemoryRouter>,
        );
        act(() => {
            useBackgroundJobs.getState().updateJob("ai-batch-b1", aiBatchJob({stopCode: "MISSING_API_KEY"}));
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        const [message, options] = vi.mocked(toast.error).mock.calls[0];
        expect(message).toBe("Stopped: the AI engine has no API key");
        expect((options as {action?: {label: string}}).action?.label).toBe("Choose engine");
    });
});
