/**
 * Dialog to export articles as CSV, RIS, or RDF (and optional files).
 * Article scope: current list (default) or selected only.
 * Submit disabled when article count is zero.
 * On 202 (async): sends export to background notifications and closes.
 */

import {useEffect, useState} from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Label} from "@/components/ui/label";
import {RadioGroup, RadioGroupItem} from "@/components/ui/radio-group";
import {toast} from "sonner";
import {Loader2} from "lucide-react";
import {t} from "@/lib/copy";
import {
    startExport,
    type ExportFormat,
    type FileScope,
    type StartExportResult,
} from "@/services/articlesExportService";
import {useBackgroundJobs} from "@/stores/useBackgroundJobs";
import {createArticlesExportJob} from "@/types/background-jobs";

const FORMATS: { id: ExportFormat; labelKey: string }[] = [
    {id: "csv", labelKey: "exportFormatCsv"},
    {id: "ris", labelKey: "exportFormatRis"},
    {id: "rdf", labelKey: "exportFormatRdf"},
];

const FILE_SCOPES: { id: FileScope; labelKey: string }[] = [
    {id: "none", labelKey: "exportFileScopeNone"},
    {id: "main_only", labelKey: "exportFileScopeMainOnly"},
    {id: "all", labelKey: "exportFileScopeAll"},
];

export type ArticleScope = "current_list" | "selected";

interface ArticlesExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    /** IDs for "current list" (filtered list). */
    currentListIds: string[];
    /** IDs for "selected" (user selection). */
    selectedIds: string[];
    /** Default article scope when dialog opens. */
    defaultArticleScope?: ArticleScope;
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function ArticlesExportDialog({
                                         open,
                                         onOpenChange,
                                         projectId,
                                         currentListIds,
                                         selectedIds,
                                         defaultArticleScope = "current_list",
                                     }: ArticlesExportDialogProps) {
    const {addJob} = useBackgroundJobs();
    const [formats, setFormats] = useState<ExportFormat[]>(["csv"]);
    const [fileScope, setFileScope] = useState<FileScope>("none");
    const [articleScope, setArticleScope] = useState<ArticleScope>(defaultArticleScope);
    const [submitting, setSubmitting] = useState(false);

    const articleIds =
        articleScope === "selected" ? selectedIds : currentListIds;
    const articleCount = articleIds.length;
    const canSubmit = articleCount > 0 && formats.length > 0;

    useEffect(() => {
        if (!open) return;
        setArticleScope(defaultArticleScope);
    }, [open, defaultArticleScope]);

    const handleFormatChange = (format: ExportFormat, checked: boolean) => {
        setFormats((prev) =>
            checked ? [...prev, format] : prev.filter((f) => f !== format)
        );
    };

    const handleSubmit = async () => {
        if (!canSubmit || submitting) return;
        setSubmitting(true);
        try {
            const result: StartExportResult = await startExport(
                projectId,
                articleIds,
                formats,
                fileScope
            );
            if (result.kind === "sync") {
                triggerDownload(result.blob, result.filename);
                toast.success(t("articles", "exportSuccess"));
                onOpenChange(false);
            } else {
                const job = createArticlesExportJob(projectId, result.jobId, {
                    articleCount,
                    fileScope,
                    formats,
                });
                addJob(job);
                toast.info(t("articles", "exportStarted"));
                onOpenChange(false);
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : "Export failed";
            toast.error(t("articles", "exportError"), {description: message});
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("articles", "exportTitle")}</DialogTitle>
                    <DialogDescription>{t("articles", "exportDesc")}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-2">
                    <div className="space-y-3">
                        <Label>{t("articles", "exportFormats")}</Label>
                        <div className="flex flex-wrap gap-4">
                            {FORMATS.map(({id, labelKey}) => (
                                <div key={id} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`format-${id}`}
                                        checked={formats.includes(id)}
                                        onCheckedChange={(c) =>
                                            handleFormatChange(id, c === true)
                                        }
                                    />
                                    <Label
                                        htmlFor={`format-${id}`}
                                        className="text-sm font-normal cursor-pointer"
                                    >
                                        {t("articles", labelKey)}
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-3">
                        <Label>{t("articles", "exportFileScope")}</Label>
                        <RadioGroup
                            value={fileScope}
                            onValueChange={(v) => setFileScope(v as FileScope)}
                            className="flex flex-col gap-2"
                        >
                            {FILE_SCOPES.map(({id, labelKey}) => (
                                <div key={id} className="flex items-center space-x-2">
                                    <RadioGroupItem value={id} id={`scope-${id}`}/>
                                    <Label
                                        htmlFor={`scope-${id}`}
                                        className="text-sm font-normal cursor-pointer"
                                    >
                                        {t("articles", labelKey)}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>
                    <div className="space-y-3">
                        <Label>{t("articles", "exportArticleScope")}</Label>
                        <RadioGroup
                            value={articleScope}
                            onValueChange={(v) => setArticleScope(v as ArticleScope)}
                            className="flex flex-col gap-2"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="current_list" id="scope-current"/>
                                <Label
                                    htmlFor="scope-current"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("articles", "exportArticleScopeCurrentList")} (
                                    {currentListIds.length})
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="selected" id="scope-selected"/>
                                <Label
                                    htmlFor="scope-selected"
                                    className="text-sm font-normal cursor-pointer"
                                >
                                    {t("articles", "exportArticleScopeSelected")} ({selectedIds.length}
                                    )
                                </Label>
                            </div>
                        </RadioGroup>
                        {articleCount === 0 && (
                            <p className="text-sm text-muted-foreground">
                                {t("articles", "exportNoArticles")}
                            </p>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting}
                    >
                        {t("articles", "listCancel")}
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!canSubmit || submitting}
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                {t("articles", "exportExporting")}
                            </>
                        ) : (
                            t("articles", "exportSubmit")
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
