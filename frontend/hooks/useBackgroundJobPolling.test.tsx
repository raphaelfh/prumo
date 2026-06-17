/**
 * Regression coverage for useBackgroundJobPolling.
 *
 * Root-cause guard for the async-export "never downloads" incident
 * (extraction + articles export): the completion observer must fire
 * `onJobComplete` / `onJobFailed` when a background job transitions
 * INTO a terminal state. The original implementation only inspected
 * `getActiveJobs()` (running|pending), so a job became invisible the
 * instant it completed and the completion toast (+ download action)
 * never appeared — the worker built and signed the file, but the user
 * never saw a download.
 */

import {beforeEach, describe, expect, it, vi} from "vitest";
import {act, renderHook} from "@testing-library/react";
import {useBackgroundJobPolling} from "@/hooks/useBackgroundJobPolling";
import {useBackgroundJobs} from "@/stores/useBackgroundJobs";
import {createExtractionExportJob} from "@/types/background-jobs";

function addRunningExportJob(id: string) {
    const job = {
        ...createExtractionExportJob("proj-1", "backend-1", {
            templateId: "tpl-1",
            mode: "all_users" as const,
            articleCount: 19,
            includeAiMetadata: true,
            anonymizeReviewerNames: false,
        }),
        id,
        status: "running" as const,
    };
    act(() => {
        useBackgroundJobs.getState().addJob(job);
    });
    return job;
}

beforeEach(() => {
    act(() => {
        useBackgroundJobs.setState({jobs: []});
    });
});

describe("useBackgroundJobPolling", () => {
    it("fires onJobComplete when a job transitions to completed", () => {
        const onJobComplete = vi.fn();
        renderHook(() => useBackgroundJobPolling({onJobComplete}));

        addRunningExportJob("job-1");
        expect(onJobComplete).not.toHaveBeenCalled();

        act(() => {
            useBackgroundJobs.getState().updateJob("job-1", {
                status: "completed",
                completedAt: Date.now(),
            });
        });

        expect(onJobComplete).toHaveBeenCalledTimes(1);
        const completed = onJobComplete.mock.calls[0][0];
        expect(completed.id).toBe("job-1");
        expect(completed.status).toBe("completed");
    });

    it("fires onJobFailed when a job transitions to failed", () => {
        const onJobFailed = vi.fn();
        renderHook(() => useBackgroundJobPolling({onJobFailed}));

        addRunningExportJob("job-2");

        act(() => {
            useBackgroundJobs.getState().updateJob("job-2", {
                status: "failed",
                completedAt: Date.now(),
                error: "boom",
            });
        });

        expect(onJobFailed).toHaveBeenCalledTimes(1);
        expect(onJobFailed.mock.calls[0][0].status).toBe("failed");
    });

    it("does not re-fire onJobComplete for a job that was already completed on mount", () => {
        const onJobComplete = vi.fn();
        // Seed an already-completed job before the hook mounts.
        act(() => {
            useBackgroundJobs.getState().addJob({
                ...createExtractionExportJob("proj-1", "backend-3", {
                    templateId: "tpl-1",
                    mode: "consensus" as const,
                    articleCount: 1,
                    includeAiMetadata: false,
                    anonymizeReviewerNames: false,
                }),
                id: "job-3",
                status: "completed",
                completedAt: Date.now(),
            });
        });

        renderHook(() => useBackgroundJobPolling({onJobComplete}));

        expect(onJobComplete).not.toHaveBeenCalled();
    });
});
