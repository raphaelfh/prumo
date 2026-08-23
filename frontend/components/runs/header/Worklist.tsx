/**
 * RunHeader.Worklist — the centered article pager.
 *
 * Two arrow buttons with an INERT counter between them. The searchable
 * article picker that used to hang off the counter now lives in the ⌘K command
 * palette (`RunHeader.CommandPalette`), which both run screens mount.
 *
 * The arrows are DISABLED at the ends rather than hidden: hiding one changes
 * the block's width and would displace the header's centre by half an arrow.
 *
 * TODO(plan-future): per-article status is not shown — the `articles` prop
 * carries only id + title, and a batch runs endpoint would be needed. The list
 * this refers to now lives in CommandPalette.tsx.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { KbdBadge } from '@/components/ui/kbd-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/copy';
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from '@/lib/runs/shortcuts';

// =================== TYPES ===================

export interface WorklistProps {
  articles: { id: string; title: string }[];
  currentId: string;
  onNavigate: (id: string) => void;
}

// =================== COMPONENT ===================

export function Worklist({ articles, currentId, onNavigate }: WorklistProps) {
  const idx = articles.findIndex((a) => a.id === currentId);
  // Self-guarding: callers used to wrap this in `articles.length > 1 &&`, and
  // only one of the two run screens remembered to.
  if (articles.length < 2 || idx < 0) return null;

  const hasPrev = idx > 0;
  const hasNext = idx < articles.length - 1;

  const total = String(articles.length);
  // Pad with FIGURE SPACE (U+2007), which is exactly one digit wide. With
  // `tabular-nums` this keeps "9 / 12" and "10 / 12" the same width, so the
  // pager cannot shift the header's centre as you page through. Written as an
  // escape on purpose — a literal U+2007 in source is invisible to the next
  // reader.
  const current = String(idx + 1).padStart(total.length, '\u2007');

  const positionLabel = t('runs', 'worklistPositionLabel')
    .replace('{{n}}', String(idx + 1))
    .replace('{{m}}', total);

  return (
    <nav className="flex shrink-0 items-center gap-0.5" aria-label={positionLabel}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HeaderIconButton
            aria-label={t('runs', 'articlePrevious')}
            disabled={!hasPrev}
            onClick={() => hasPrev && onNavigate(articles[idx - 1].id)}
          >
            <ChevronLeft strokeWidth={1.5} aria-hidden="true" />
          </HeaderIconButton>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          {t('runs', 'articlePrevious')}
          <KbdBadge keys={[ARTICLE_PREV_KEY]} />
        </TooltipContent>
      </Tooltip>

      {/* Inert on purpose — the position is announced by the <nav> label. */}
      <span
        className="whitespace-pre text-[11px] tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        {current} / {total}
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <HeaderIconButton
            aria-label={t('runs', 'articleNext')}
            disabled={!hasNext}
            onClick={() => hasNext && onNavigate(articles[idx + 1].id)}
          >
            <ChevronRight strokeWidth={1.5} aria-hidden="true" />
          </HeaderIconButton>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          {t('runs', 'articleNext')}
          <KbdBadge keys={[ARTICLE_NEXT_KEY]} />
        </TooltipContent>
      </Tooltip>
    </nav>
  );
}
