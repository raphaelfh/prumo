/**
 * ArticleFilesSection — the article editor's files card.
 *
 * Presentational: it renders the stored file list, the empty state, and the
 * delete confirmation, and reports intent through callbacks. It deliberately
 * imports nothing from `@/services/` and does not call `toast` — every async
 * concern (loading, deleting, downloading) stays with ArticleForm, which owns
 * the article's identity.
 */

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Download, Eye, FileText, Plus, Trash2, Upload} from 'lucide-react';
import {t} from '@/lib/copy';
import type {FileRole} from '@/lib/file-constants';
import type {ArticleFileRecord} from '@/services/articlesService';

/**
 * A file the user attached before the article row existed. It lives only in this
 * tree: a `File` cannot be re-fetched, so nothing may unmount the form while one
 * of these is still unsent.
 */
export interface StagedArticleFile {
    id: string;
    file: File;
    role: FileRole;
    error?: string;
}

interface ArticleFilesSectionProps {
    files: ArticleFileRecord[];
    stagedFiles: StagedArticleFile[];
    onRemoveStaged: (id: string) => void;
    /** The file awaiting delete confirmation, or null when the dialog is closed. */
    fileToDelete: ArticleFileRecord | null;
    deleting: boolean;
    onView: (file: ArticleFileRecord) => void;
    onDownload: (file: ArticleFileRecord) => void;
    onRequestDelete: (file: ArticleFileRecord) => void;
    onCancelDelete: () => void;
    onConfirmDelete: () => void;
    onAddFiles: () => void;
}

export function ArticleFilesSection({
                                        files,
                                        stagedFiles,
                                        onRemoveStaged,
                                        fileToDelete,
                                        deleting,
                                        onView,
                                        onDownload,
                                        onRequestDelete,
                                        onCancelDelete,
                                        onConfirmDelete,
                                        onAddFiles,
                                    }: ArticleFilesSectionProps) {
    return (
        <>
            <Card className="rounded-md border-border/40 shadow-elev-popover">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
                    <div className="min-w-0 space-y-1.5">
                        <CardTitle className="text-[13px] font-medium leading-none">
                            {t('articles', 'articleFiles')}
                        </CardTitle>
                        <CardDescription className="text-[12px] text-muted-foreground/70">
                            {t('articles', 'articleFilesDesc')}
                        </CardDescription>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-[12px]"
                        onClick={onAddFiles}
                    >
                        <Plus className="mr-1.5 h-3.5 w-3.5"/>
                        {t('articles', 'addFiles')}
                    </Button>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                    {files.length > 0 || stagedFiles.length > 0 ? (
                        <div className="space-y-2">
                            {stagedFiles.map((staged) => (
                                <div
                                    key={staged.id}
                                    className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border/50 px-2 py-2"
                                >
                                    <div className="flex min-w-0 items-center gap-2">
                                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground"/>
                                        <div className="min-w-0">
                                            <p className="truncate text-[13px] font-medium">{staged.file.name}</p>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                                <Badge variant="outline"
                                                       className="h-5 px-1.5 text-[10px] font-normal">
                                                    {staged.role}
                                                </Badge>
                                                <span className="text-[11px] text-muted-foreground">
                                                    {(staged.file.size / 1024 / 1024).toFixed(2)} MB
                                                </span>
                                                <span className="text-[11px] text-muted-foreground/70">
                                                    {t('articles', 'stagedPending')}
                                                </span>
                                            </div>
                                            {staged.error && (
                                                <p className="mt-1 text-[11px] text-destructive">
                                                    {t('articles', 'stagedUploadFailed')}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="shrink-0 text-destructive hover:text-destructive"
                                        onClick={() => onRemoveStaged(staged.id)}
                                        aria-label={t('articles', 'stagedRemoveAria')}
                                    >
                                        <Trash2 className="h-3.5 w-3.5"/>
                                    </Button>
                                </div>
                            ))}
                            {files.map((file) => (
                                <div
                                    key={file.id}
                                    className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-2"
                                >
                                    <div className="flex min-w-0 items-center gap-2">
                                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground"/>
                                        <div className="min-w-0">
                                            <p className="truncate text-[13px] font-medium">
                                                {file.original_filename || 'document.pdf'}
                                            </p>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                                <Badge variant="outline"
                                                       className="h-5 px-1.5 text-[10px] font-normal">
                                                    {file.file_role}
                                                </Badge>
                                                {file.bytes != null && (
                                                    <span className="text-[11px] text-muted-foreground">
                                                        {(file.bytes / 1024 / 1024).toFixed(2)} MB
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="px-2 text-[11px]"
                                            onClick={() => onView(file)}
                                        >
                                            <Eye className="mr-1 h-3 w-3"/>
                                            {t('articles', 'formViewPdf')}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="px-2 text-[11px]"
                                            onClick={() => onDownload(file)}
                                        >
                                            <Download className="mr-1 h-3 w-3"/>
                                            {t('articles', 'formDownloadPdf')}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => onRequestDelete(file)}
                                            aria-label={t('articles', 'removeFile')}
                                        >
                                            <Trash2 className="h-3.5 w-3.5"/>
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-[13px] text-muted-foreground">
                            <Upload className="mx-auto mb-3 h-9 w-9 opacity-40"/>
                            <p>{t('articles', 'noFilesAddedYet')}</p>
                            <p className="mt-1 text-[11px]">{t('articles', 'addFilesHint')}</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={fileToDelete !== null} onOpenChange={(open) => !open && onCancelDelete()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('articles', 'confirmRemove')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('articles', 'confirmRemoveFile')} &quot;{fileToDelete?.original_filename}&quot;? {t('articles', 'confirmRemoveDesc')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>{t('common', 'cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={onConfirmDelete}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? t('articles', 'removing') : t('articles', 'remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
