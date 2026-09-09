/**
 * ArticlesListDialogs — the delete-one and bulk-delete confirmation dialogs
 * for ArticlesList. Extracted out of ArticlesList.tsx to keep that file
 * under the file-size fitness cap (`scripts/fitness/check_file_size.py`).
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
} from "@/components/ui/alert-dialog";
import {t} from "@/lib/copy";

interface ArticlesListDialogsProps {
    deleteOpen: boolean;
    onDeleteOpenChange: (open: boolean) => void;
    onConfirmDelete: () => void;
    bulkOpen: boolean;
    onBulkOpenChange: (open: boolean) => void;
    onConfirmBulkDelete: () => void;
    bulkCount: number;
    deleting: boolean;
}

export function ArticlesListDialogs({
    deleteOpen,
    onDeleteOpenChange,
    onConfirmDelete,
    bulkOpen,
    onBulkOpenChange,
    onConfirmBulkDelete,
    bulkCount,
    deleting,
}: ArticlesListDialogsProps) {
    return (
        <>
            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('articles', 'listConfirmDelete')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('articles', 'listConfirmDeleteDesc')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('articles', 'listCancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={onConfirmDelete}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? t('articles', 'listDeleting') : t('articles', 'listDelete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Bulk Delete Confirmation Dialog */}
            <AlertDialog open={bulkOpen} onOpenChange={onBulkOpenChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('articles', 'listConfirmBulkDelete')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('articles', 'listConfirmBulkDeleteDesc').replace('{{n}}', String(bulkCount))}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('articles', 'listCancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={onConfirmBulkDelete}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting
                                ? t('articles', 'listDeleting')
                                : t('articles', 'listDeleteCount').replace('{{n}}', String(bulkCount))}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
