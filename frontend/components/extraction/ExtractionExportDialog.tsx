/**
 * Dialog to export extraction data as an Excel workbook (.xlsx).
 *
 * Feature: 009-extraction-excel-export.
 * Mirrors the visual structure of ArticlesExportDialog so the
 * cross-page UX stays consistent. Sync uploads stream the blob via
 * the browser; async uploads dispatch a BackgroundJob + toast.
 */

import {useEffect, useRef, useState} from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Label} from "@/components/ui/label";
import {RadioGroup, RadioGroupItem} from "@/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {AlertCircle, Loader2} from "lucide-react";
import {toast} from "sonner";
import {t} from "@/lib/copy";
import {useEligibleReviewers} from "@/hooks/exports/useEligibleReviewers";
import {useAuth} from "@/contexts/AuthContext";
import {
    startExport,
} from "@/services/extractionExportService";
import {useBackgroundJobs} from "@/stores/useBackgroundJobs";
import {createExtractionExportJob} from "@/types/background-jobs";
import type {
    ExtractionArticleScope,
    ExtractionExportMode,
    ExtractionExportRequest,
    StartExtractionExportResult,
} from "@/types/extraction-export";

interface ExtractionExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    projectName?: string;
    /** Active project_extraction_templates id (drives the layout). */
    templateId: string;
    templateName?: string;
    /** Article ids visible on the page given current filters/search. */
    currentListIds: string[];
    /** Article ids ticked in the Article-Extraction table. */
    selectedIds: string[];
    /** Whether the current user has the project manager role. */
    isManager: boolean;
    /** Default article scope when opening; overrides "smart default" if set. */
    defaultArticleScope?: ExtractionArticleScope;
    /** Total field count in the active template — drives the live preview. */
    fieldCount?: number;
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Mirror of the backend SYNC_EXPORT_MAX_ARTICLES (research.md §3). */
const SYNC_EXPORT_MAX_ARTICLES = 50;

export function ExtractionExportDialog({
    open,
    onOpenChange,
    projectId,
    projectName,
    templateId,
    templateName,
    currentListIds,
    selectedIds,
    isManager,
    defaultArticleScope,
    fieldCount,
}: ExtractionExportDialogProps) {
    const {addJob} = useBackgroundJobs();
    const {user} = useAuth();
    const [mode, setMode] = useState<ExtractionExportMode>("consensus");
    const [reviewerId, setReviewerId] = useState<string | null>(null);
    const initialScope: ExtractionArticleScope =
        defaultArticleScope ?? (selectedIds.length > 0 ? "selected_only" : "current_list");
    const [articleScope, setArticleScope] =
        useState<ExtractionArticleScope>(initialScope);
    const [includeAiMetadata, setIncludeAiMetadata] = useState(false);
    const [anonymizeReviewerNames, setAnonymizeReviewerNames] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // AbortController for in-flight cancellation (FR-030).
    const abortRef = useRef<AbortController | null>(null);

    // Re-apply smart default + reset transient state each time the
    // dialog opens (FR-029). Adjusted during render instead of via effect;
    // the null sentinel makes the first render perform the initial reset.
    const userId = user?.id;
    const [prevResetKey, setPrevResetKey] = useState<{
        open: boolean;
        defaultArticleScope: typeof defaultArticleScope;
        selectedCount: number;
        userId: string | undefined;
    } | null>(null);
    if (
        !prevResetKey ||
        open !== prevResetKey.open ||
        defaultArticleScope !== prevResetKey.defaultArticleScope ||
        selectedIds.length !== prevResetKey.selectedCount ||
        userId !== prevResetKey.userId
    ) {
        setPrevResetKey({open, defaultArticleScope, selectedCount: selectedIds.length, userId});
        if (open) {
            setArticleScope(
                defaultArticleScope ??
                (selectedIds.length > 0 ? "selected_only" : "current_list"),
            );
            setIncludeAiMetadata(false);
            setAnonymizeReviewerNames(false);
            setMode("consensus");
            setReviewerId(userId ?? null);
            setError(null);
            setSubmitting(false);
        }
    }

    // US2 reviewer picker source. Only fetched when the dialog is open.
    const reviewersQuery = useEligibleReviewers(projectId, templateId, {
        enabled: open,
    });
    const reviewers = reviewersQuery.data ?? [];

    const reviewersLoading = reviewersQuery.isLoading;
    // True once the picker has loaded and nobody is eligible — the project has
    // no non-reject reviewer decisions on this template yet, so single-user
    // export is impossible and we surface an empty-state instead of a blank
    // dropdown the user cannot resolve.
    const noEligibleReviewers =
        mode === "single_user" && !reviewersLoading && reviewers.length === 0;

    // Reconcile the reviewer selection against the eligible list (render-phase
    // invariant — each branch makes the guard false next render, so it
    // terminates). Default to "me" when I'm eligible; clear a selection that
    // isn't in the list so Export stays blocked until a real reviewer is
    // chosen — we never silently export a reviewer who has no data.
    if (mode === "single_user" && !reviewersLoading && reviewers.length > 0) {
        const selectedIsEligible =
            reviewerId !== null && reviewers.some((r) => r.id === reviewerId);
        if (!selectedIsEligible) {
            const self = reviewers.find((r) => r.id === userId);
            setReviewerId(self ? self.id : null);
        }
    }

    // Abort any in-flight request if the dialog closes while submitting.
    useEffect(() => {
        if (!open && abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }
    }, [open]);

    const articleIds =
        articleScope === "selected_only" ? selectedIds : currentListIds;
    const articleCount = articleIds.length;
    const modeReady =
        mode !== "single_user" ||
        (reviewerId !== null && reviewers.some((r) => r.id === reviewerId));
    const canSubmit = articleCount > 0 && modeReady && !submitting;

    const expectedSync =
        mode !== "all_users" && !includeAiMetadata && articleCount <= SYNC_EXPORT_MAX_ARTICLES;

    // FR-027 live preview line. When the parent doesn't know the field
    // count (e.g. the template metadata hasn't been fetched), drop the
    // fields clause entirely rather than printing a dangling "× — fields".
    const previewLine = (() => {
        const delivery = expectedSync
            ? t("extraction", "exportPreviewDeliveryInline")
            : t("extraction", "exportPreviewDeliveryAsync");
        if (fieldCount == null) {
            return t("extraction", "exportPreviewLineNoFieldsFmt")
                .replace("{articles}", String(articleCount))
                .replace("{delivery}", delivery);
        }
        return t("extraction", "exportPreviewLineFmt")
            .replace("{articles}", String(articleCount))
            .replace("{fields}", String(fieldCount))
            .replace("{delivery}", delivery);
    })();

    // Build the request payload from the current state.
    const buildRequest = (): ExtractionExportRequest => ({
        template_id: templateId,
        mode,
        reviewer_id: mode === "single_user" ? reviewerId : null,
        article_scope: articleScope,
        article_ids: articleIds,
        include_ai_metadata: includeAiMetadata,
        anonymize_reviewer_names: anonymizeReviewerNames,
    });

    const submit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);

        const controller = new AbortController();
        abortRef.current = controller;
        const request = buildRequest();

        const result = await startExport(projectId, request, controller.signal).then(
            (r): { ok: true; data: StartExtractionExportResult } => ({ok: true, data: r}),
            (err: Error) => ({ok: false, error: err} as const),
        );

        if (result.ok) {
            if (result.data.kind === "sync") {
                triggerDownload(result.data.blob, result.data.filename);
                toast.success(t("extraction", "exportSuccessToast"));
                onOpenChange(false);
            } else {
                addJob(
                    createExtractionExportJob(projectId, result.data.job_id, {
                        projectName,
                        templateId,
                        templateName,
                        mode,
                        articleCount,
                        includeAiMetadata,
                        anonymizeReviewerNames,
                    }),
                );
                toast.info(t("extraction", "exportStartedToast"));
                onOpenChange(false);
            }
        } else if (result.error.name !== "AbortError") {
            // AbortError = user cancelled — silent; other errors surface inline
            const message = result.error.message ?? t("extraction", "exportFailedToast");
            setError(message);
        }

        setSubmitting(false);
        abortRef.current = null;
    };

    const dismiss = () => {
        if (abortRef.current) abortRef.current.abort();
        onOpenChange(false);
    };

    // Cmd/Ctrl + Enter to submit (FR-006 / FR-035).
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (canSubmit) void submit();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, canSubmit, submit]);

    return (
        <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : dismiss())}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("extraction", "exportDialogTitle")}</DialogTitle>
                    <DialogDescription>
                        {t("extraction", "exportDialogSubtitle")}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-2">
                    {/* 1. Source of values */}
                    <div className="space-y-3">
                        <Label>{t("extraction", "exportSourceLabel")}</Label>
                        <RadioGroup
                            value={mode}
                            onValueChange={(v) => setMode(v as ExtractionExportMode)}
                            className="flex flex-col gap-2"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="consensus" id="mode-consensus"/>
                                <Label
                                    htmlFor="mode-consensus"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("extraction", "exportSourceConsensus")}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="single_user" id="mode-single"/>
                                <Label
                                    htmlFor="mode-single"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("extraction", "exportSourceSingleUser")}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem
                                    value="all_users"
                                    id="mode-all"
                                    disabled={!isManager}
                                    title={
                                        !isManager
                                            ? t(
                                                "extraction",
                                                "exportSourceAllUsersDisabledTooltip",
                                            )
                                            : undefined
                                    }
                                />
                                <Label
                                    htmlFor="mode-all"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("extraction", "exportSourceAllUsers")}
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {/* 1b. Reviewer picker (US2 — only when mode=single_user) */}
                    {mode === "single_user" && (
                        <div className="space-y-2">
                            <Label htmlFor="reviewer-picker">
                                {t("extraction", "exportReviewerLabel")}
                            </Label>
                            {noEligibleReviewers ? (
                                <p
                                    className="text-sm text-muted-foreground"
                                    data-testid="extraction-export-reviewer-empty"
                                >
                                    {t("extraction", "exportReviewerEmptyState")}
                                </p>
                            ) : isManager ? (
                                <Select
                                    value={reviewerId ?? undefined}
                                    onValueChange={(v) => setReviewerId(v)}
                                >
                                    <SelectTrigger
                                        id="reviewer-picker"
                                        data-testid="extraction-export-reviewer-picker"
                                    >
                                        <SelectValue
                                            placeholder={reviewersQuery.isLoading ? "…" : "—"}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {reviewers.map((r) => (
                                            <SelectItem key={r.id} value={r.id}>
                                                {r.name}
                                                {r.id === user?.id ? " (you)" : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <p
                                    className="text-sm text-muted-foreground"
                                    data-testid="extraction-export-reviewer-locked"
                                >
                                    {reviewers.find((r) => r.id === user?.id)?.name ?? "—"}
                                    {" "}
                                    <span className="text-xs">
                                        ({t("extraction", "exportReviewerSelfFallback")})
                                    </span>
                                </p>
                            )}
                        </div>
                    )}

                    {/* 2. Articles to export */}
                    <div className="space-y-3">
                        <Label>{t("extraction", "exportScopeLabel")}</Label>
                        <RadioGroup
                            value={articleScope}
                            onValueChange={(v) =>
                                setArticleScope(v as ExtractionArticleScope)
                            }
                            className="flex flex-col gap-2"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="current_list" id="scope-current"/>
                                <Label
                                    htmlFor="scope-current"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("extraction", "exportScopeCurrentList")} ({currentListIds.length})
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem
                                    value="selected_only"
                                    id="scope-selected"
                                    disabled={selectedIds.length === 0}
                                />
                                <Label
                                    htmlFor="scope-selected"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("extraction", "exportScopeSelectedOnly")} ({selectedIds.length})
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {/* 3. Additional content */}
                    <div className="space-y-3">
                        <Label>{t("extraction", "exportAdditionalLabel")}</Label>
                        <div className="flex items-start space-x-2">
                            <Checkbox
                                id="include-ai-metadata"
                                checked={includeAiMetadata}
                                onCheckedChange={(c) => setIncludeAiMetadata(c === true)}
                                className="mt-0.5"
                            />
                            <div className="space-y-0.5">
                                <Label
                                    htmlFor="include-ai-metadata"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("extraction", "exportIncludeAiMetadata")}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {t("extraction", "exportIncludeAiMetadataDesc")}
                                </p>
                            </div>
                        </div>
                        {mode === "all_users" && isManager && (
                            <div className="flex items-start space-x-2">
                                <Checkbox
                                    id="anonymize-reviewers"
                                    checked={anonymizeReviewerNames}
                                    onCheckedChange={(c) =>
                                        setAnonymizeReviewerNames(c === true)
                                    }
                                    className="mt-0.5"
                                />
                                <div className="space-y-0.5">
                                    <Label
                                        htmlFor="anonymize-reviewers"
                                        className="text-sm font-normal cursor-pointer"
                                    >
                                        {t("extraction", "exportAnonymizeReviewers")}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        {t("extraction", "exportAnonymizeReviewersDesc")}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Live preview line (FR-027) */}
                    {articleCount > 0 && !noEligibleReviewers && (
                        <p
                            className="text-xs text-muted-foreground"
                            aria-live="polite"
                            data-testid="extraction-export-preview"
                        >
                            {previewLine}
                        </p>
                    )}
                    {articleCount === 0 && (
                        <p className="text-sm text-muted-foreground">
                            {t("extraction", "exportEmptyNoArticlesReason")}
                        </p>
                    )}

                    {/* Inline error banner (FR-031) */}
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4"/>
                            <AlertTitle>{t("extraction", "exportFailedToast")}</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={dismiss}
                        disabled={submitting}
                    >
                        {t("extraction", "exportCancel")}
                    </Button>
                    {error && !submitting ? (
                        <Button onClick={() => void submit()} disabled={!canSubmit}>
                            {t("extraction", "exportRetry")}
                        </Button>
                    ) : (
                        <Button
                            onClick={() => void submit()}
                            disabled={!canSubmit}
                            data-testid="extraction-export-submit"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                    {t("extraction", "exportGenerating")}
                                </>
                            ) : (
                                t("extraction", "exportConfirm")
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
