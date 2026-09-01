/**
 * Dialog to export HITL data as an Excel workbook (.xlsx).
 *
 * One dialog, two surfaces: Data Extraction mounts it with a single
 * template, Quality Assessment with every tool the project has enabled.
 * The multi-tool picker renders only above one template, so the extraction
 * surface is visually unchanged and there is no `kind` conditional anywhere
 * in here.
 *
 * Sync uploads stream the blob via the browser; async uploads dispatch a
 * BackgroundJob + toast. Selecting N tools starts N exports and produces N
 * workbooks, each byte-for-byte what a single-tool export produces —
 * sequential, so they stay inside the endpoint's rate limit and N browser
 * downloads do not race.
 *
 * Feature: 009-extraction-excel-export. Copy stays in the `extraction`
 * namespace, which `HITLArticleTable` already uses for every shared string.
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
import {triggerDownload} from "@/lib/download";
import {ApiError} from "@/integrations/api/client";
import {useEligibleReviewers} from "@/hooks/exports/useEligibleReviewers";
import {useAuth} from "@/contexts/AuthContext";
import {startExport} from "@/services/extractionExportService";
import {useBackgroundJobs} from "@/stores/useBackgroundJobs";
import {createExtractionExportJob} from "@/types/background-jobs";
import type {
    ExtractionExportMode,
    ExtractionExportRequest,
    ExtractionExportShape,
    StartExtractionExportResult,
} from "@/types/extraction-export";

/** One exportable template as the dialog needs it. */
export interface ExportTemplateOption {
    id: string;
    name: string;
}

interface HITLExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    projectName?: string;
    /**
     * Templates this surface can export, **active one first** — it is the
     * default tick, and the picker lists them in this order.
     */
    templates: ExportTemplateOption[];
    /** Article ids visible on the page given current filters/search. */
    currentListIds: string[];
    /** Whether the current user has the project manager role. */
    isManager: boolean;
    /** Total field count in the active template — drives the live preview. */
    fieldCount?: number;
}

/** Mirror of the backend SYNC_EXPORT_MAX_ARTICLES (research.md §3). */
const SYNC_EXPORT_MAX_ARTICLES = 50;

const SHAPES: {
    value: ExtractionExportShape;
    label: string;
    description: string;
}[] = [
    {
        value: "complete",
        label: t("extraction", "exportShapeComplete"),
        description: t("extraction", "exportShapeCompleteDesc"),
    },
    {
        value: "dictionary",
        label: t("extraction", "exportShapeDictionary"),
        description: t("extraction", "exportShapeDictionaryDesc"),
    },
    {
        value: "publication",
        label: t("extraction", "exportShapePublication"),
        description: t("extraction", "exportShapePublicationDesc"),
    },
];

/**
 * The message to show for one failed tool.
 *
 * 429 is special-cased on `status`, not on the message: slowapi's rate-limit
 * body carries a bare string `error`, which the typed client flattens to its
 * generic unknown-error text — so the reason the user actually needs would
 * otherwise be lost.
 */
function failureMessage(error: Error): string {
    if (error instanceof ApiError && error.status === 429) {
        return t("extraction", "exportRateLimited");
    }
    return error.message || t("extraction", "exportFailedToast");
}

export function HITLExportDialog({
    open,
    onOpenChange,
    projectId,
    projectName,
    templates,
    currentListIds,
    isManager,
    fieldCount,
}: HITLExportDialogProps) {
    const {addJob} = useBackgroundJobs();
    const {user} = useAuth();
    const [mode, setMode] = useState<ExtractionExportMode>("consensus");
    const [reviewerId, setReviewerId] = useState<string | null>(null);
    const [shape, setShape] = useState<ExtractionExportShape>("complete");
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(
        templates.length > 0 ? [templates[0].id] : [],
    );
    const [includeAiMetadata, setIncludeAiMetadata] = useState(false);
    const [anonymizeReviewerNames, setAnonymizeReviewerNames] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [failures, setFailures] = useState<string[]>([]);

    // AbortController for in-flight cancellation (FR-030).
    const abortRef = useRef<AbortController | null>(null);

    // Reset transient state each time the dialog opens (FR-029). Adjusted
    // during render instead of via effect; the null sentinel makes the first
    // render perform the initial reset.
    const userId = user?.id;
    const templatesKey = templates.map((tpl) => tpl.id).join(",");
    const [prevResetKey, setPrevResetKey] = useState<{
        open: boolean;
        templatesKey: string;
        userId: string | undefined;
    } | null>(null);
    if (
        !prevResetKey ||
        open !== prevResetKey.open ||
        templatesKey !== prevResetKey.templatesKey ||
        userId !== prevResetKey.userId
    ) {
        setPrevResetKey({open, templatesKey, userId});
        if (open) {
            setIncludeAiMetadata(false);
            setAnonymizeReviewerNames(false);
            setMode("consensus");
            setShape("complete");
            setSelectedTemplateIds(templates.length > 0 ? [templates[0].id] : []);
            setReviewerId(userId ?? null);
            setError(null);
            setFailures([]);
            setSubmitting(false);
        }
    }

    // Eligibility is per template, so a reviewer offered for tool A may have
    // no decisions on tool B — a union across tools would offer a pick whose
    // submit then 422s. Single-user therefore exports ONE tool at a time, and
    // the picker stays a single-template question. (Render-phase adjustment;
    // the branch makes its own guard false next render, so it terminates.)
    if (mode === "single_user" && selectedTemplateIds.length > 1) {
        setSelectedTemplateIds(selectedTemplateIds.slice(0, 1));
    }

    const reviewerTemplateId = selectedTemplateIds[0] ?? null;

    // US2 reviewer picker source. Only fetched when the dialog is open.
    const reviewersQuery = useEligibleReviewers(projectId, reviewerTemplateId, {
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

    const articleIds = currentListIds;
    const articleCount = articleIds.length;
    const modeReady =
        mode !== "single_user" ||
        (reviewerId !== null && reviewers.some((r) => r.id === reviewerId));
    const canSubmit =
        articleCount > 0 && modeReady && selectedTemplateIds.length > 0 && !submitting;

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

    // Build the request payload for one template.
    //
    // `article_scope` is held at "current_list": the field is a real part of
    // the API contract and the backend still validates it, but the dialog no
    // longer offers a choice (its only mount site always passed an empty
    // selection, so "Selected only" had always rendered disabled).
    const buildRequest = (templateId: string): ExtractionExportRequest => ({
        template_id: templateId,
        mode,
        reviewer_id: mode === "single_user" ? reviewerId : null,
        article_scope: "current_list",
        article_ids: articleIds,
        include_ai_metadata: includeAiMetadata,
        anonymize_reviewer_names: anonymizeReviewerNames,
        shape,
    });

    const toggleTemplate = (templateId: string, checked: boolean) => {
        setSelectedTemplateIds((current) =>
            checked
                ? [...current, templateId]
                : current.filter((id) => id !== templateId),
        );
    };

    const submit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        setFailures([]);

        const controller = new AbortController();
        abortRef.current = controller;

        // Sequential, and outcomes are collected rather than merged: a tool
        // with no finalized assessments returns 422 EMPTY_ELIGIBLE_ARTICLES,
        // and that must not swallow the ones that succeeded.
        const failed: string[] = [];
        let succeeded = 0;
        let aborted = false;

        for (const templateId of selectedTemplateIds) {
            const template = templates.find((tpl) => tpl.id === templateId);
            const result = await startExport(
                projectId,
                buildRequest(templateId),
                controller.signal,
            ).then(
                (r): {ok: true; data: StartExtractionExportResult} => ({ok: true, data: r}),
                (err: Error) => ({ok: false, error: err} as const),
            );

            if (result.ok) {
                succeeded += 1;
                if (result.data.kind === "sync") {
                    triggerDownload(result.data.blob, result.data.filename);
                } else {
                    addJob(
                        createExtractionExportJob(projectId, result.data.job_id, {
                            projectName,
                            templateId,
                            templateName: template?.name,
                            mode,
                            articleCount,
                            includeAiMetadata,
                            anonymizeReviewerNames,
                        }),
                    );
                }
            } else if (result.error.name === "AbortError") {
                // User cancelled — silent, and the remaining tools are dropped.
                aborted = true;
                break;
            } else {
                failed.push(`${template?.name ?? templateId} — ${failureMessage(result.error)}`);
            }
        }

        if (!aborted) {
            if (succeeded > 0) {
                toast[expectedSync ? "success" : "info"](
                    t("extraction", expectedSync ? "exportSuccessToast" : "exportStartedToast"),
                );
            }
            if (failed.length > 0) {
                // Stay open and name what failed; the successful downloads have
                // already been triggered.
                setFailures(failed);
                setError(t("extraction", "exportPartialFailureTitle"));
            } else {
                onOpenChange(false);
            }
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

    const singleUser = mode === "single_user";

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
                    {singleUser && (
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

                    {/* 2. Templates — only above one; a single-template surface
                        (extraction) is visually unchanged. */}
                    {templates.length > 1 && (
                        <div className="space-y-3" data-testid="export-template-picker">
                            <Label>{t("extraction", "exportTemplatesLabel")}</Label>
                            {singleUser ? (
                                <>
                                    <RadioGroup
                                        value={selectedTemplateIds[0] ?? undefined}
                                        onValueChange={(v) => setSelectedTemplateIds([v])}
                                        className="flex flex-col gap-2"
                                    >
                                        {templates.map((tpl) => (
                                            <div
                                                key={tpl.id}
                                                className="flex items-center space-x-2"
                                            >
                                                <RadioGroupItem
                                                    value={tpl.id}
                                                    id={`export-template-${tpl.id}`}
                                                />
                                                <Label
                                                    htmlFor={`export-template-${tpl.id}`}
                                                    className="text-sm font-normal cursor-pointer"
                                                >
                                                    {tpl.name}
                                                </Label>
                                            </div>
                                        ))}
                                    </RadioGroup>
                                    <p className="text-xs text-muted-foreground">
                                        {t("extraction", "exportTemplatesSingleUserHint")}
                                    </p>
                                </>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {templates.map((tpl) => (
                                        <div key={tpl.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`export-template-${tpl.id}`}
                                                checked={selectedTemplateIds.includes(tpl.id)}
                                                onCheckedChange={(c) =>
                                                    toggleTemplate(tpl.id, c === true)
                                                }
                                            />
                                            <Label
                                                htmlFor={`export-template-${tpl.id}`}
                                                className="text-sm font-normal cursor-pointer"
                                            >
                                                {tpl.name}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 3. Sheets to include */}
                    <div className="space-y-3">
                        <Label>{t("extraction", "exportShapeLabel")}</Label>
                        <RadioGroup
                            value={shape}
                            onValueChange={(v) => setShape(v as ExtractionExportShape)}
                            className="flex flex-col gap-2"
                        >
                            {SHAPES.map((option) => (
                                <div
                                    key={option.value}
                                    className="flex items-start space-x-2"
                                >
                                    <RadioGroupItem
                                        value={option.value}
                                        id={`shape-${option.value}`}
                                        className="mt-0.5"
                                    />
                                    <div className="space-y-0.5">
                                        <Label
                                            htmlFor={`shape-${option.value}`}
                                            className="text-sm font-normal cursor-pointer"
                                        >
                                            {option.label}
                                        </Label>
                                        <p className="text-xs text-muted-foreground">
                                            {option.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>

                    {/* 4. Additional content */}
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
                            <AlertTitle>{error}</AlertTitle>
                            {failures.length > 0 && (
                                <AlertDescription>
                                    <ul
                                        className="list-disc space-y-0.5 pl-4"
                                        data-testid="extraction-export-failures"
                                    >
                                        {failures.map((line) => (
                                            <li key={line}>{line}</li>
                                        ))}
                                    </ul>
                                </AlertDescription>
                            )}
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button
                      size="sm"
                        variant="outline"
                        onClick={dismiss}
                        disabled={submitting}
                    >
                        {t("extraction", "exportCancel")}
                    </Button>
                    {error && !submitting ? (
                        <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
                            {t("extraction", "exportRetry")}
                        </Button>
                    ) : (
                        <Button
                          size="sm"
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
