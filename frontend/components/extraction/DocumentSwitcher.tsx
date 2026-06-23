/**
 * Document switcher for the extraction / QA PDF panel.
 *
 * Presentational dropdown over an article's files (MAIN + supplements), with a
 * per-file parse-status dot. Selecting a document is the caller's concern
 * (it also clears viewer citations/search/page to avoid cross-document leak).
 * `ReparseButton` recovers a `parse_failed` file in-place — the same recovery
 * the Articles dialog offers, surfaced where the failure is seen.
 * `ParseStatusControl` is a status-aware sibling that adds a confirm dialog for
 * re-parsing a successfully-parsed file and an error tooltip for parse failures.
 */
import { memo, useState } from 'react';
import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FILE_ROLE_LABELS, type FileRole } from '@/lib/file-constants';
import { t } from '@/lib/copy';
import { cn } from '@/lib/utils';
import { articleKeys } from '@/lib/query-keys';
import { reparseArticleFile } from '@/services/articlesService';
import type { ArticleFileListItem } from '@/services/articleFilesService';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useReparseArticleFile } from '@/hooks/extraction/useReparseArticleFile';

// Module-level cva — kept at module scope to satisfy React Compiler (no inline objects).
const statusDot = cva('h-1.5 w-1.5 shrink-0 rounded-full', {
  variants: {
    status: {
      parsed: 'bg-success',
      pending: 'bg-warning animate-pulse',
      parse_failed: 'bg-destructive',
      unknown: 'bg-muted-foreground/40',
    },
  },
  defaultVariants: { status: 'unknown' },
});

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

type ParseStatus = 'parsed' | 'pending' | 'parse_failed' | 'unknown';

function toStatus(s: string): ParseStatus {
  return s === 'parsed' || s === 'pending' || s === 'parse_failed' ? s : 'unknown';
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
              className={statusDot({ status: toStatus(selected.extractionStatus) })}
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
                className={statusDot({ status: toStatus(file.extractionStatus) })}
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

export interface ParseStatusControlProps {
  articleId: string;
  file: ArticleFileListItem;
}

/**
 * Status-aware control showing parse status + a contextual re-parse action.
 * - `pending`     → spinner + "Processing…" + ghost Retry
 * - `parsed`      → "Ready" + low-emphasis Re-parse behind an AlertDialog confirm
 * - `parse_failed`→ "Parse failed" (error in Tooltip) + prominent Retry parse
 */
export function ParseStatusControl({ articleId, file }: ParseStatusControlProps) {
  const status = toStatus(file.extractionStatus);
  const reparse = useReparseArticleFile(articleId);
  const fire = () => reparse.mutate(file.id);

  const label =
    status === 'parsed' ? t('pdf', 'docStatusReady')
    : status === 'pending' ? t('pdf', 'docStatusPending')
    : status === 'parse_failed' ? t('pdf', 'docStatusFailed')
    : '';

  return (
    <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground">
      {status === 'pending' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden />
      ) : (
        <span aria-hidden className={statusDot({ status })} />
      )}

      {status === 'parse_failed' && file.extractionError ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{label}</span>
          </TooltipTrigger>
          <TooltipContent>
            {t('pdf', 'docParseErrorLabel')}: {file.extractionError}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span>{label}</span>
      )}

      {status === 'parsed' ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={reparse.isPending}
              aria-label={t('pdf', 'docReparse')}
            >
              {t('pdf', 'docReparse')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('pdf', 'docReparseConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('pdf', 'docReparseConfirmBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={fire} aria-label={t('pdf', 'docReparseConfirmCta')}>
                {t('pdf', 'docReparseConfirmCta')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        (status === 'parse_failed' || status === 'pending') && (
          <Button
            size="sm"
            variant={status === 'parse_failed' ? 'outline' : 'ghost'}
            className="h-7 text-xs"
            disabled={reparse.isPending}
            onClick={fire}
            aria-label={t('pdf', 'docReparse')}
          >
            {t('pdf', 'docReparse')}
          </Button>
        )
      )}
    </div>
  );
}
