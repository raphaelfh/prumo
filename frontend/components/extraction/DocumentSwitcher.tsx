/**
 * Document switcher for the extraction / QA PDF panel.
 *
 * Presentational dropdown over an article's files (MAIN + supplements), with a
 * per-file parse-status dot. It sits centred in the viewer toolbar, so the
 * trigger is borderless chrome rather than a form field. Selecting a document
 * is the caller's concern (it also clears the viewer's locate highlight,
 * search, and page to avoid cross-document leak).
 * The re-parse control lives in the viewer's ☰ menu (`useParseStatus` +
 * `ParseStatusMenuItem` + `ParseStatusOverlay`), so it costs no toolbar width;
 * the status it used to show stays visible on this switcher's trigger dot.
 */
import { memo, useState } from 'react';
import { cva } from 'class-variance-authority';
import { Loader2, RotateCw } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
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

export interface ParseStatusControl {
  status: ParseStatus;
  /** False when there is no file, or its status is unrecognised — nothing to render. */
  isAvailable: boolean;
  /** Plain-language status: Ready / Processing / Failed. */
  label: string;
  /** What selecting the item will do. */
  hint: string;
  /** The parser's error, on a failure only. */
  errorDetail: string | null;
  isPending: boolean;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  /** Re-parse, or ask first when the file is already parsed. */
  select: () => void;
  /** Re-parse now (the confirm's CTA). */
  confirm: () => void;
}

/**
 * Parse status + the re-parse mutation for one file.
 *
 * Split from its rendering because the two halves cannot live in the same
 * place: the menu item belongs inside the ☰ menu, while the confirm dialog and
 * the live region must sit OUTSIDE it — `DropdownMenuContent` unmounts its
 * children when the menu closes, which would tear the dialog down as it opens
 * and silence the status the moment the menu shuts.
 */
export function useParseStatus(
  articleId: string,
  file: ArticleFileListItem | null,
): ParseStatusControl {
  // Takes a nullable file rather than being called conditionally: no document
  // is selected until the file list resolves, and hooks cannot be skipped.
  const status = file ? toStatus(file.extractionStatus) : 'unknown';
  const reparse = useReparseArticleFile(articleId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fire = () => {
    if (file) reparse.mutate(file.id);
  };

  return {
    status,
    isAvailable: status !== 'unknown',
    label:
      status === 'parsed' ? t('pdf', 'docStatusReady')
      : status === 'pending' ? t('pdf', 'docStatusPending')
      : t('pdf', 'docStatusFailed'),
    hint:
      status === 'parsed' ? t('pdf', 'docReparseHint')
      : status === 'pending' ? t('pdf', 'docReparsePendingHint')
      : t('pdf', 'docReparseRetryHint'),
    errorDetail:
      status === 'parse_failed'
        ? file?.extractionError
          ? `${t('pdf', 'docParseErrorLabel')}: ${file.extractionError}`
          : t('pdf', 'docParseErrorUnknown')
        : null,
    isPending: reparse.isPending,
    confirmOpen,
    setConfirmOpen,
    // An already-parsed file asks first: re-parsing discards the current text.
    select: () => (status === 'parsed' ? setConfirmOpen(true) : fire()),
    confirm: fire,
  };
}

/**
 * The re-parse entry in the viewer's ☰ menu. It states the status and what
 * re-parsing does on its own second line, so the explanation needs no hover —
 * a tooltip nested in a menu item would fight the menu's own hover and focus
 * handling.
 */
export function ParseStatusMenuItem({ control }: { control: ParseStatusControl }) {
  if (control.status === 'unknown') {
    return null;
  }
  return (
    <DropdownMenuItem
      disabled={control.isPending}
      // Let the menu close: the confirm dialog and the live region render
      // outside it (see `ParseStatusOverlay`), so nothing here unmounts them.
      onSelect={control.select}
    >
      {control.status === 'pending' ? (
        <Loader2 className="mr-2 size-4 shrink-0 animate-spin" strokeWidth={1.5} aria-hidden />
      ) : (
        <RotateCw
          className={cn('mr-2 size-4 shrink-0', control.status === 'parse_failed' && 'text-destructive')}
          strokeWidth={1.5}
          aria-hidden
        />
      )}
      <span className="flex min-w-0 flex-col">
        <span>{t('pdf', 'docReparse')}</span>
        <span className="text-xs text-muted-foreground">{control.label} · {control.hint}</span>
        {control.errorDetail && (
          <span className="break-words text-xs text-destructive">{control.errorDetail}</span>
        )}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The half of the re-parse control that must stay mounted while the ☰ menu
 * opens and closes: the confirm dialog, and the live region that announces the
 * parse status now that no toolbar button shows it.
 */
export function ParseStatusOverlay({ control }: { control: ParseStatusControl }) {
  if (control.status === 'unknown') {
    return null;
  }
  return (
    <>
      <span role="status" className="sr-only">{control.label}</span>
      <AlertDialog open={control.confirmOpen} onOpenChange={control.setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('pdf', 'docReparseConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('pdf', 'docReparseConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={control.confirm} aria-label={t('pdf', 'docReparseConfirmCta')}>
              {t('pdf', 'docReparseConfirmCta')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
