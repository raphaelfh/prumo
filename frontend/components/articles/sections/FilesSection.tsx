/**
 * FilesSection — the article editor's "files" step. Thin wrapper around
 * `ArticleFilesSection` that owns the section anchor; ArticleForm keeps every
 * async concern (upload/download/delete) and passes callbacks down.
 *
 * Unlike the other sections, this one is NOT converted to ArticleFieldRow:
 * ArticleFilesSection renders a file LIST with row actions (view/download/
 * delete/add), not a set of label -> value fields. A label/value row is the
 * wrong shape for a list item that has multiple actions and no single
 * "value" to edit inline. Only the surrounding card chrome and the
 * now-redundant description are dropped, matching the other sections'
 * single plain heading.
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
        <section id="article-section-files" className="scroll-mt-4 space-y-1">
            <SettingsSection title={t('articles', 'filesLabel')}>
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
