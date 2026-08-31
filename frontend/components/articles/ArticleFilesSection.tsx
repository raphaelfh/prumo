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
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {AlertCircle, Download, Eye, FileText, Plus, Trash2, Upload} from 'lucide-react';
import {t} from '@/lib/copy';
import type {ArticleFileRecord} from '@/services/articlesService';

interface ArticleFilesSectionProps {
    files: ArticleFileRecord[];
    /** False while the article has no row yet — files cannot be attached. */
    canAddFiles: boolean;
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
                                        canAddFiles,
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
                        disabled={!canAddFiles}
                    >
                        <Plus className="mr-1.5 h-3.5 w-3.5"/>
                        {t('articles', 'addFiles')}
                    </Button>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                    {!canAddFiles ? (
                        <Alert className="border-border/50 py-2">
                            <AlertCircle className="h-3.5 w-3.5"/>
                            <AlertDescription className="text-[13px]">
                                {t('articles', 'formSaveFirstFiles')}
                            </AlertDescription>
                        </Alert>
                    ) : files.length > 0 ? (
                        <div className="space-y-2">
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
