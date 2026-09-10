/**
 * Document switcher for the extraction / QA PDF panel.
 *
 * Presentational dropdown over an article's files (MAIN + supplements), with a
 * per-file parse-status dot. It sits centred in the viewer toolbar, so the
 * trigger is borderless chrome rather than a form field. Selecting a document
 * is the caller's concern (it also clears the viewer's locate highlight,
 * search, and page to avoid cross-document leak).
 * `ParseStatusControl` is an icon button beside the viewer's mode toggle: its
 * tooltip states the parse status and what re-parsing does, with a confirm
 * dialog for already-parsed files and the error detail for parse failures.
 */
import { memo } from 'react';
import { cva } from 'class-variance-authority';
import { Loader2, RotateCw } from 'lucide-react';

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
import type { ArticleFileListItem } from '@/services/articleFilesService';
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

  // The dot and the name are DIRECT span children on purpose: the trigger's
  // base `[&>span]:line-clamp-1` turns a wrapping flex span into a
  // -webkit-box, which collapsed the inline dot to zero width.
  return (
    <Select value={selectedFileId ?? undefined} onValueChange={onSelect}>
      <SelectTrigger
        aria-label={t('pdf', 'docSwitcherAria')}
        className={cn(
          'h-7 w-auto min-w-0 max-w-72 justify-center gap-1.5 border-transparent bg-transparent px-2 text-[13px] font-medium hover:bg-accent focus:ring-offset-0 data-[state=open]:bg-accent [&>svg]:size-3.5',
          className,
        )}
      >
        {selected && (
          <span aria-hidden className={statusDot({ status: toStatus(selected.extractionStatus) })} />
        )}
        <span className="min-w-0 truncate">{selected ? fileLabel(selected) : ''}</span>
      </SelectTrigger>
      <SelectContent>
        {files.map((file) => (
          <SelectItem key={file.id} value={file.id} className="text-[13px]">
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

export interface ParseStatusControlProps {
  articleId: string;
  file: ArticleFileListItem;
}

/**
 * Icon-only re-parse control; the status lives in its tooltip (and in the
 * switcher's dot), announced to assistive tech through a polite live region.
 * - `pending`     → spinner; click retries
 * - `parsed`      → re-parse icon behind an AlertDialog confirm
 * - `parse_failed`→ destructive re-parse icon; tooltip carries the error
 */
export function ParseStatusControl({ articleId, file }: ParseStatusControlProps) {
  const status = toStatus(file.extractionStatus);
  const reparse = useReparseArticleFile(articleId);
  const fire = () => reparse.mutate(file.id);

  if (status === 'unknown') {
    return null;
  }

  const label =
    status === 'parsed' ? t('pdf', 'docStatusReady')
    : status === 'pending' ? t('pdf', 'docStatusPending')
    : t('pdf', 'docStatusFailed');

  const hint =
    status === 'parsed' ? t('pdf', 'docReparseHint')
    : status === 'pending' ? t('pdf', 'docReparsePendingHint')
    : t('pdf', 'docReparseRetryHint');

  const button = (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'text-muted-foreground',
        status === 'parse_failed' && 'text-destructive hover:text-destructive',
      )}
      disabled={reparse.isPending}
      onClick={status === 'parsed' ? undefined : fire}
      aria-label={t('pdf', 'docReparse')}
    >
      {status === 'pending' ? (
        <Loader2 className="animate-spin" strokeWidth={1.5} aria-hidden />
      ) : (
        <RotateCw strokeWidth={1.5} aria-hidden />
      )}
    </Button>
  );

  const tooltip = (
    <TooltipContent side="bottom" className="max-w-64 px-2.5 py-1.5 text-[12px]">
      <p className="font-medium">{label}</p>
      {status === 'parse_failed' && (
        <p className="break-words text-muted-foreground">
          {file.extractionError
            ? `${t('pdf', 'docParseErrorLabel')}: ${file.extractionError}`
            : t('pdf', 'docParseErrorUnknown')}
        </p>
      )}
      <p className="text-muted-foreground">{hint}</p>
    </TooltipContent>
  );

  return (
    <>
      <span role="status" className="sr-only">{label}</span>
      {status === 'parsed' ? (
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
            </TooltipTrigger>
            {tooltip}
          </Tooltip>
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
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          {tooltip}
        </Tooltip>
      )}
    </>
  );
}
