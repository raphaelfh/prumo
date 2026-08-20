/**
 * The published-version timeline (B-9e).
 *
 * A Sheet rather than a dialog, matching `TemplateConfigDiffSheet`: this is
 * a list the manager reads and scrolls, not a decision they answer.
 *
 * Every row answers three questions the spec asks for — who published it,
 * when, and why (the `note` migration 0052 added) — plus the one number
 * that makes a version's blast radius legible: how many runs are still
 * pinned to it. `ExtractionRun.version_id` is ON DELETE RESTRICT, so a
 * non-zero count means that version is permanent.
 *
 * Read order matters, same as the diff sheet: a FAILED read is answered
 * before the empty case, or a dropped connection renders as "this template
 * has no history".
 *
 * @module components/extraction/template-config/TemplateVersionHistorySheet
 */
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useRestoreTemplateVersion} from '@/hooks/extraction/useRestoreTemplateVersion';
import {useTemplateVersionHistory} from '@/hooks/extraction/useTemplateVersionHistory';
import {t} from '@/lib/copy';
import type {TemplateVersionHistoryEntry} from '@/services/templateService';

interface TemplateVersionHistorySheetProps {
  projectId: string;
  templateId: string;
  onClose: () => void;
}

/** Absolute date + time — a timeline of publishes needs the real moment,
 * not "3 days ago", because versions are compared against each other. */
function publishedAt(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

function HistoryRow({
  entry,
  onRestore,
  restoring,
}: {
  entry: TemplateVersionHistoryEntry;
  onRestore: (entry: TemplateVersionHistoryEntry) => void;
  restoring: boolean;
}) {
  return (
    <li
      data-testid={`template-version-${entry.version}`}
      className="border-t border-border/40 px-5 py-3 first:border-t-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {t('templateConfig', 'historyVersionLabel').replace(
            '{{n}}',
            String(entry.version),
          )}
        </span>
        {entry.is_active && (
          <Badge variant="secondary" className="text-[0.6875rem]">
            {t('templateConfig', 'historyActiveBadge')}
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t('templateConfig', 'historyPublishedBy')
          .replace('{{who}}', entry.published_by_name ?? t('templateConfig', 'historyUnknownAuthor'))
          .replace('{{when}}', publishedAt(entry.published_at))}
      </p>
      {entry.note != null && entry.note.trim() !== '' && (
        // The publisher's own words. Wrapped, never truncated: a note the
        // reader cannot finish is worse than no note.
        <p className="mt-1.5 whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 text-xs">
          {entry.note}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {(entry.pinned_run_count === 1
            ? t('templateConfig', 'historyPinnedRunsOne')
            : t('templateConfig', 'historyPinnedRunsOther')
          ).replace('{{n}}', String(entry.pinned_run_count))}
        </p>
        {/* The ACTIVE version has nothing to restore — the live tree
            already is it (modulo an open draft), so the button would
            promise a change it cannot make. */}
        {!entry.is_active && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                disabled={restoring}
                onClick={() => onRestore(entry)}
              >
                {t('templateConfig', 'historyRestoreAction')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('templateConfig', 'historyRestoreTooltip')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

export function TemplateVersionHistorySheet({
  projectId,
  templateId,
  onClose,
}: TemplateVersionHistorySheetProps) {
  const {data, isPending, isError} = useTemplateVersionHistory(projectId, templateId);
  const {restore, restoring} = useRestoreTemplateVersion(projectId, templateId);
  const versions = data?.versions ?? [];

  const handleRestore = (entry: TemplateVersionHistoryEntry) => {
    // Promise .then, not try/finally — the React Compiler bans the latter
    // in component bodies.
    void restore(entry.version_id).then((result) => {
      if (!result) return;
      // A restore that changed nothing is reported as such rather than as
      // success: the marker was never stamped, so Publish stays disabled
      // and a "restored!" toast would leave the manager hunting for it.
      toast.success(
        (result.changed
          ? t('templateConfig', 'historyRestoreSuccess')
          : t('templateConfig', 'historyRestoreNoop')
        ).replace('{{n}}', String(result.version)),
      );
      if (result.kept_count > 0) {
        toast.info(
          t('templateConfig', 'historyRestoreKept').replace(
            '{{n}}',
            String(result.kept_count),
          ),
        );
      }
      onClose();
    });
  };

  let body;
  if (isPending) {
    body = <p className="px-5 py-6 text-xs text-muted-foreground">{t('templateConfig', 'historyLoading')}</p>;
  } else if (isError || data == null) {
    // Answered BEFORE the empty case: a failed read must never render as
    // "this template has never been published".
    body = (
      <p className="px-5 py-6 text-xs text-muted-foreground">
        {t('templateConfig', 'historyLoadFailed')}
      </p>
    );
  } else if (versions.length === 0) {
    body = (
      <p className="px-5 py-6 text-xs text-muted-foreground">
        {t('templateConfig', 'historyEmpty')}
      </p>
    );
  } else {
    body = (
      <ul>
        {versions.map((entry) => (
          <HistoryRow
            key={entry.version_id}
            entry={entry}
            onRestore={handleRestore}
            restoring={restoring}
          />
        ))}
      </ul>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[26rem]"
      >
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>{t('templateConfig', 'historySheetTitle')}</SheetTitle>
          <SheetDescription>
            {t('templateConfig', 'historySheetDescription')}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">{body}</ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
