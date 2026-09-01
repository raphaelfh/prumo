/**
 * Vitest coverage for HITLExportDialog — the one dialog both HITL surfaces render.
 *
 * Validates:
 *  - submit calls startExport and triggers the download (US1 happy path)
 *  - in-flight spinner + disabled submit (FR-030)
 *  - inline error renders error.message and exposes Retry (FR-031)
 *  - "Include AI metadata sheet" checkbox forwards the flag (FR-002 §3)
 *  - the output-shape radio reaches the request (§3)
 *  - N selected tools issue N SEQUENTIAL requests, and a partial failure
 *    names the tool that failed without swallowing the ones that worked (§4)
 *  - single-user mode is single-tool: reviewer eligibility is per template
 */

import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";

// ---- Mocks (hoisted so vi.mock factories can reference them) ----------

const {
    startExportMock,
    addJobMock,
    toastSuccess,
    toastInfo,
    useAuthMock,
    useEligibleReviewersMock,
    ApiError,
} = vi.hoisted(() => {
    // Mirrors integrations/api/client's ApiError. Standing it up here keeps the
    // test off the real module, which pulls in the Supabase client and throws
    // without VITE_SUPABASE_* — set locally, absent in CI's frontend job.
    class ApiError extends Error {
        constructor(
            public code: string,
            message: string,
            public status: number,
        ) {
            super(message);
            this.name = "ApiError";
        }
    }
    return {
        startExportMock: vi.fn(),
        addJobMock: vi.fn(),
        toastSuccess: vi.fn(),
        toastInfo: vi.fn(),
        useAuthMock: vi.fn(),
        useEligibleReviewersMock: vi.fn(),
        ApiError,
    };
});

vi.mock("@/services/extractionExportService", () => ({
    startExport: (...args: unknown[]) => startExportMock(...args),
    getExportStatus: vi.fn(),
    cancelExport: vi.fn(),
}));

vi.mock("@/stores/useBackgroundJobs", () => ({
    useBackgroundJobs: () => ({addJob: addJobMock}),
}));

vi.mock("@/contexts/AuthContext", () => ({
    useAuth: () => useAuthMock(),
}));

vi.mock("@/hooks/exports/useEligibleReviewers", () => ({
    useEligibleReviewers: () => useEligibleReviewersMock(),
}));

vi.mock("@/integrations/api/client", () => ({
    ApiError,
    apiClient: vi.fn(),
    apiBlobClient: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: {success: toastSuccess, info: toastInfo, error: vi.fn()},
}));

// JSDOM lacks URL.createObjectURL.
beforeEach(() => {
    startExportMock.mockReset();
    addJobMock.mockReset();
    toastSuccess.mockReset();
    toastInfo.mockReset();
    useAuthMock.mockReturnValue({
        user: {id: "00000000-0000-0000-0000-000000000099"},
    });
    useEligibleReviewersMock.mockReturnValue({
        data: [
            {id: "00000000-0000-0000-0000-000000000099", name: "Alice"},
            {id: "00000000-0000-0000-0000-0000000000aa", name: "Bob"},
        ],
        isLoading: false,
    });
    (window as unknown as {URL: typeof URL}).URL.createObjectURL = vi.fn(
        () => "blob:mock",
    );
    (window as unknown as {URL: typeof URL}).URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
    vi.useRealTimers();
});

import {HITLExportDialog} from "./HITLExportDialog";

const PROBAST = {id: "22222222-2222-2222-2222-222222222222", name: "PROBAST"};
const QUADAS = {id: "33333333-3333-3333-3333-333333333333", name: "QUADAS-2"};

function renderDialog(
    overrides: Partial<React.ComponentProps<typeof HITLExportDialog>> = {},
) {
    const onOpenChange = vi.fn();
    const props: React.ComponentProps<typeof HITLExportDialog> = {
        open: true,
        onOpenChange,
        projectId: "11111111-1111-1111-1111-111111111111",
        projectName: "Demo Project",
        templates: [PROBAST],
        currentListIds: ["a1", "a2", "a3"],
        isManager: true,
        fieldCount: 42,
        ...overrides,
    };
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    return {
        ...render(
            <QueryClientProvider client={client}>
                <HITLExportDialog {...props} />
            </QueryClientProvider>,
        ),
        onOpenChange,
        props,
    };
}

// ---- Tests --------------------------------------------------------------

describe("HITLExportDialog", () => {
    it("sends the consensus request and triggers a blob download on sync success", async () => {
        startExportMock.mockResolvedValueOnce({
            kind: "sync",
            blob: new Blob(["fake xlsx"]),
            filename: "demo_charms_consensus_20260523-120000.xlsx",
        });
        const user = userEvent.setup();
        const {onOpenChange} = renderDialog();
        await user.click(screen.getByTestId("extraction-export-submit"));

        await waitFor(() => expect(startExportMock).toHaveBeenCalledTimes(1));
        const callArgs = startExportMock.mock.calls[0];
        expect(callArgs[0]).toBe("11111111-1111-1111-1111-111111111111");
        const requestArg = callArgs[1];
        expect(requestArg).toMatchObject({
            template_id: "22222222-2222-2222-2222-222222222222",
            mode: "consensus",
            article_scope: "current_list",
            article_ids: ["a1", "a2", "a3"],
            include_ai_metadata: false,
        });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it("dispatches a background job on async (202) response", async () => {
        startExportMock.mockResolvedValueOnce({
            kind: "async",
            job_id: "celery-job-id",
        });
        const user = userEvent.setup();
        renderDialog({currentListIds: Array.from({length: 60}, (_, i) => `id-${i}`)});
        await user.click(screen.getByTestId("extraction-export-submit"));
        await waitFor(() => expect(addJobMock).toHaveBeenCalledTimes(1));
        expect(addJobMock.mock.calls[0][0]).toMatchObject({
            type: "extraction-export",
            status: "pending",
            metadata: {backendJobId: "celery-job-id"},
        });
        expect(toastInfo).toHaveBeenCalled();
    });

    it("shows 'Generating…' spinner on the submit button while the request is in flight (FR-030)", async () => {
        let resolve: (v: unknown) => void = () => {};
        startExportMock.mockImplementationOnce(
            () => new Promise((r) => (resolve = r)),
        );
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByTestId("extraction-export-submit"));
        // While the promise is pending, the button label flips.
        await waitFor(() =>
            expect(screen.getByTestId("extraction-export-submit")).toHaveTextContent(
                /Generating/i,
            ),
        );
        // Resolve to let the component clean up.
        resolve({kind: "sync", blob: new Blob(["x"]), filename: "x.xlsx"});
    });

    it("renders an inline error banner with error.message and a Retry button (FR-031)", async () => {
        startExportMock.mockRejectedValueOnce(
            new Error("You are not allowed to do this"),
        );
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByTestId("extraction-export-submit"));
        await waitFor(() =>
            expect(
                screen.getByText(/You are not allowed to do this/i),
            ).toBeInTheDocument(),
        );
        // Retry button replaces the Export button until cleared.
        expect(screen.getByRole("button", {name: /Retry/i})).toBeInTheDocument();
    });

    it("forwards include_ai_metadata=true when the checkbox is ticked (FR-002 §3)", async () => {
        startExportMock.mockResolvedValueOnce({
            kind: "sync",
            blob: new Blob(["x"]),
            filename: "x.xlsx",
        });
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByLabelText(/Include AI metadata sheet/i));
        await user.click(screen.getByTestId("extraction-export-submit"));
        await waitFor(() => expect(startExportMock).toHaveBeenCalled());
        expect(startExportMock.mock.calls[0][1].include_ai_metadata).toBe(true);
    });

    it("hides the All-users option for non-managers (FR-004)", () => {
        renderDialog({isManager: false});
        const allUsers = screen.getByLabelText(/All users/i) as HTMLInputElement;
        expect(allUsers).toBeDisabled();
    });

    it("reveals the reviewer picker when Single-user is selected (US2 / FR-028)", async () => {
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByLabelText(/Single user/i));
        await waitFor(() =>
            expect(
                screen.getByTestId("extraction-export-reviewer-picker"),
            ).toBeInTheDocument(),
        );
    });

    it("locks the reviewer picker to the current user for non-managers (FR-028)", async () => {
        const user = userEvent.setup();
        renderDialog({isManager: false});
        await user.click(screen.getByLabelText(/Single user/i));
        await waitFor(() =>
            expect(
                screen.getByTestId("extraction-export-reviewer-locked"),
            ).toBeInTheDocument(),
        );
        // Combobox not rendered.
        expect(
            screen.queryByTestId("extraction-export-reviewer-picker"),
        ).not.toBeInTheDocument();
    });

    it("sends reviewer_id in the request when Single-user mode is submitted (US2)", async () => {
        startExportMock.mockResolvedValueOnce({
            kind: "sync",
            blob: new Blob(["x"]),
            filename: "x.xlsx",
        });
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByLabelText(/Single user/i));
        await user.click(screen.getByTestId("extraction-export-submit"));
        await waitFor(() => expect(startExportMock).toHaveBeenCalled());
        expect(startExportMock.mock.calls[0][1].mode).toBe("single_user");
        expect(startExportMock.mock.calls[0][1].reviewer_id).toBe(
            "00000000-0000-0000-0000-000000000099",
        );
    });

    it("blocks Single-user export with an empty-state when no reviewer has decisions", async () => {
        useEligibleReviewersMock.mockReturnValue({data: [], isLoading: false});
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByLabelText(/Single user/i));

        // Empty-state message replaces the picker — there is nobody to pick.
        await waitFor(() =>
            expect(
                screen.getByTestId("extraction-export-reviewer-empty"),
            ).toBeInTheDocument(),
        );
        expect(
            screen.queryByTestId("extraction-export-reviewer-picker"),
        ).not.toBeInTheDocument();
        // Export is blocked so the user cannot submit a doomed request.
        expect(screen.getByTestId("extraction-export-submit")).toBeDisabled();
    });

    it("renders the anonymize-reviewers toggle only when All-users mode + manager (US3 / FR-028)", async () => {
        const user = userEvent.setup();
        renderDialog();
        // Initially Consensus → no anonymize toggle
        expect(
            screen.queryByLabelText(/Anonymize reviewer names/i),
        ).not.toBeInTheDocument();
        await user.click(screen.getByLabelText(/All users/i));
        await waitFor(() =>
            expect(
                screen.getByLabelText(/Anonymize reviewer names/i),
            ).toBeInTheDocument(),
        );
    });

    it("forwards anonymize_reviewer_names=true when toggled (US3)", async () => {
        startExportMock.mockResolvedValueOnce({
            kind: "async",
            job_id: "abc",
        });
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByLabelText(/All users/i));
        await user.click(screen.getByLabelText(/Anonymize reviewer names/i));
        await user.click(screen.getByTestId("extraction-export-submit"));
        await waitFor(() => expect(startExportMock).toHaveBeenCalled());
        expect(startExportMock.mock.calls[0][1].anonymize_reviewer_names).toBe(
            true,
        );
        expect(startExportMock.mock.calls[0][1].mode).toBe("all_users");
    });

    // ---- §3 output shape ------------------------------------------------

    it("defaults to the complete workbook", async () => {
        startExportMock.mockResolvedValueOnce({
            kind: "sync",
            blob: new Blob(["x"]),
            filename: "x.xlsx",
        });
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByTestId("extraction-export-submit"));
        await waitFor(() => expect(startExportMock).toHaveBeenCalled());
        expect(startExportMock.mock.calls[0][1].shape).toBe("complete");
    });

    it("sends the picked shape in the request (§3)", async () => {
        startExportMock.mockResolvedValueOnce({
            kind: "sync",
            blob: new Blob(["x"]),
            filename: "x.xlsx",
        });
        const user = userEvent.setup();
        renderDialog();
        await user.click(screen.getByLabelText(/Publication tables/i));
        await user.click(screen.getByTestId("extraction-export-submit"));
        await waitFor(() => expect(startExportMock).toHaveBeenCalled());
        expect(startExportMock.mock.calls[0][1].shape).toBe("publication");
    });

    // ---- §4 one or several tools ----------------------------------------

    it("hides the template picker on a single-template surface (§2)", () => {
        renderDialog();
        expect(screen.queryByTestId("export-template-picker")).not.toBeInTheDocument();
    });

    it("renders the template picker above one template, active tool ticked (§2)", () => {
        renderDialog({templates: [PROBAST, QUADAS]});
        expect(screen.getByTestId("export-template-picker")).toBeInTheDocument();
        expect(screen.getByLabelText("PROBAST")).toBeChecked();
        expect(screen.getByLabelText("QUADAS-2")).not.toBeChecked();
    });

    it("issues one sequential request per selected tool (§4)", async () => {
        startExportMock.mockResolvedValue({
            kind: "sync",
            blob: new Blob(["x"]),
            filename: "x.xlsx",
        });
        const user = userEvent.setup();
        const {onOpenChange} = renderDialog({templates: [PROBAST, QUADAS]});
        await user.click(screen.getByLabelText("QUADAS-2"));
        await user.click(screen.getByTestId("extraction-export-submit"));

        await waitFor(() => expect(startExportMock).toHaveBeenCalledTimes(2));
        expect(startExportMock.mock.calls[0][1].template_id).toBe(PROBAST.id);
        expect(startExportMock.mock.calls[1][1].template_id).toBe(QUADAS.id);
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });

    it("names the failed tool and keeps the successful downloads (§4)", async () => {
        startExportMock
            .mockResolvedValueOnce({
                kind: "sync",
                blob: new Blob(["x"]),
                filename: "probast.xlsx",
            })
            .mockRejectedValueOnce(
                new ApiError("EMPTY_ELIGIBLE_ARTICLES", "No eligible articles.", 422),
            );
        const user = userEvent.setup();
        const {onOpenChange} = renderDialog({templates: [PROBAST, QUADAS]});
        await user.click(screen.getByLabelText("QUADAS-2"));
        await user.click(screen.getByTestId("extraction-export-submit"));

        await waitFor(() => expect(startExportMock).toHaveBeenCalledTimes(2));
        const failures = await screen.findByTestId("extraction-export-failures");
        expect(failures).toHaveTextContent(/QUADAS-2/);
        expect(failures).toHaveTextContent(/No eligible articles/);
        // The PROBAST workbook already downloaded; the dialog stays open so the
        // failure is not swallowed by the success.
        expect(toastSuccess).toHaveBeenCalled();
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("names a rate limit as a rate limit, not 'unknown error' (§4)", async () => {
        startExportMock.mockRejectedValueOnce(
            new ApiError("UNKNOWN", "An unknown error occurred", 429),
        );
        const user = userEvent.setup();
        renderDialog({templates: [PROBAST, QUADAS]});
        await userEvent.setup();
        await user.click(screen.getByTestId("extraction-export-submit"));

        const failures = await screen.findByTestId("extraction-export-failures");
        expect(failures).toHaveTextContent(/Too many exports/i);
    });

    it("collapses the tool picker to one choice in single-user mode", async () => {
        const user = userEvent.setup();
        renderDialog({templates: [PROBAST, QUADAS]});
        await user.click(screen.getByLabelText("QUADAS-2"));
        expect(screen.getByLabelText("QUADAS-2")).toBeChecked();

        await user.click(screen.getByLabelText(/Single user/i));

        // Eligibility is per template, so only one tool can be targeted at a
        // time — the extra tick is dropped rather than 422ing on submit.
        await waitFor(() =>
            expect(screen.getByLabelText("QUADAS-2")).not.toBeChecked(),
        );
        expect(screen.getByLabelText("PROBAST")).toBeChecked();
    });
});
