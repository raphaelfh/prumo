/**
 * FilesSection — the article editor's "files" step. Thin wrapper around
 * `ArticleFilesSection` that owns the section anchor; ArticleForm keeps every
 * async concern (upload/download/delete) and passes callbacks down.
 */

import {ArticleFilesSection, type StagedArticleFile} from '../ArticleFilesSection';
import {SettingsSection} from '@/components/settings';
import {t} from '@/lib/copy';
import type {ArticleFileRecord} from '@/services/articlesService';

interface FilesSectionProps {
    files: ArticleFileRecord[];
    stagedFiles: StagedArticleFile[];
    onRemoveStaged: (id: string) => void;
    fileToDelete: ArticleFileRecord | null;
    deleting: boolean;
    onView: (file: ArticleFileRecord) => void;
    onDownload: (file: ArticleFileRecord) => void;
    onRequestDelete: (file: ArticleFileRecord) => void;
    onCancelDelete: () => void;
    onConfirmDelete: () => void;
    onAddFiles: () => void;
}

export function FilesSection({
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
}: FilesSectionProps) {
    return (
        <section id="article-section-files" className="scroll-mt-4 space-y-6">
            <SettingsSection title={t('articles', 'filesLabel')}
                             description={t('articles', 'filesDesc')}>
                <ArticleFilesSection
                    files={files}
                    stagedFiles={stagedFiles}
                    onRemoveStaged={onRemoveStaged}
                    fileToDelete={fileToDelete}
                    deleting={deleting}
                    onView={onView}
                    onDownload={onDownload}
                    onRequestDelete={onRequestDelete}
                    onCancelDelete={onCancelDelete}
                    onConfirmDelete={onConfirmDelete}
                    onAddFiles={onAddFiles}
                />
            </SettingsSection>
        </section>
    );
}
