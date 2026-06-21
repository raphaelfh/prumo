/**
 * Document switcher for the extraction / QA PDF panel.
 *
 * Presentational dropdown over an article's files (MAIN + supplements), with a
 * per-file parse-status dot. Selecting a document is the caller's concern
 * (it also clears viewer citations/search/page to avoid cross-document leak).
 * `ReparseButton` recovers a `parse_failed` file in-place — the same recovery
 * the Articles dialog offers, surfaced where the failure is seen.
 */
import { memo, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { FILE_ROLE_LABELS, type FileRole } from '@/lib/file-constants';
import { t } from '@/lib/copy';
import { cn } from '@/lib/utils';
import { articleKeys } from '@/lib/query-keys';
import { reparseArticleFile } from '@/services/articlesService';
import type { ArticleFileListItem } from '@/services/articleFilesService';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const STATUS_DOT: Record<string, string> = {
  parsed: 'bg-emerald-500',
  pending: 'bg-amber-500 animate-pulse',
  parse_failed: 'bg-red-500',
};

function roleLabel(role: string): string {
  return FILE_ROLE_LABELS[role as FileRole] ?? role;
}

function fileLabel(file: ArticleFileListItem): string {
  return file.originalFilename || roleLabel(file.fileRole);
}

export interface DocumentSwitcherProps {
  files: ArticleFileListItem[];
  selectedFileId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

function DocumentSwitcherComponent({
  files,
  selectedFileId,
  onSelect,
  className,
}: DocumentSwitcherProps) {
  if (files.length === 0) {
    return null;
  }

  const selected = files.find((f) => f.id === selectedFileId) ?? null;

  return (
    <Select value={selectedFileId ?? undefined} onValueChange={onSelect}>
      <SelectTrigger
        aria-label={t('pdf', 'docSwitcherAria')}
        className={cn('h-8 w-[min(20rem,45vw)] gap-2 text-xs', className)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected && (
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                STATUS_DOT[selected.extractionStatus] ?? 'bg-muted-foreground/40',
              )}
            />
          )}
          <span className="truncate">
            {selected ? fileLabel(selected) : ''}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {files.map((file) => (
          <SelectItem key={file.id} value={file.id} className="text-xs">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  STATUS_DOT[file.extractionStatus] ?? 'bg-muted-foreground/40',
                )}
              />
              <span className="truncate">{fileLabel(file)}</span>
              <span className="ml-1 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {roleLabel(file.fileRole)}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const DocumentSwitcher = memo(DocumentSwitcherComponent);
DocumentSwitcher.displayName = 'DocumentSwitcher';

export interface ReparseButtonProps {
  articleFileId: string;
  articleId: string;
}

/** Re-enqueue a parse for a `parse_failed` file and refresh the file + blocks. */
export function ReparseButton({ articleFileId, articleId }: ReparseButtonProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const onClick = () => {
    setBusy(true);
    reparseArticleFile(articleFileId)
      .then((res) => {
        if (!res.ok) {
          toast.error(res.error.message || t('pdf', 'docReparseError'));
          return;
        }
        toast.success(t('pdf', 'docReparseQueued'));
        void queryClient.invalidateQueries({ queryKey: articleKeys.files(articleId) });
        void queryClient.invalidateQueries({
          queryKey: articleKeys.textBlocks(articleFileId),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 shrink-0 text-xs"
      disabled={busy}
      onClick={onClick}
    >
      {t('pdf', 'docReparse')}
    </Button>
  );
}
