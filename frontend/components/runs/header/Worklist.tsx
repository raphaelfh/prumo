/**
 * RunHeader.Worklist — queue-peek slot.
 *
 * Renders a pill group: prev arrow | "N / total" popover trigger | next arrow.
 * The popover contains a searchable command list of all articles.
 *
 * NOTE: per-article status is NOT rendered here because the articles prop only
 * carries id + title.
 * TODO(plan-future): per-article status needs a batch runs endpoint
 */

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

// =================== TYPES ===================

export interface WorklistProps {
  articles: { id: string; title: string }[];
  currentId: string;
  onNavigate: (id: string) => void;
}

// =================== COMPONENT ===================

export function Worklist({ articles, currentId, onNavigate }: WorklistProps) {
  const [open, setOpen] = useState(false);

  const idx = articles.findIndex(a => a.id === currentId);
  const hasPrev = idx > 0;
  const hasNext = idx < articles.length - 1;

  function handleSelect(id: string) {
    setOpen(false);
    onNavigate(id);
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* Leading divider groups the article pager apart from the breadcrumb/back
          so the two never read as one crowded chevron cluster when the
          breadcrumb text collapses at narrow widths. */}
      <span className="mr-1 h-4 w-px shrink-0 bg-border/60" aria-hidden="true" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        aria-label={t('runs', 'articlePrevious')}
        disabled={!hasPrev}
        onClick={() => hasPrev && onNavigate(articles[idx - 1].id)}
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] tabular-nums text-muted-foreground [@media(pointer:coarse)]:h-11"
            aria-label={t('runs', 'worklistPositionLabel')
              .replace('{{n}}', String(idx + 1))
              .replace('{{m}}', String(articles.length))}
          >
            {idx + 1} / {articles.length}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(20rem,calc(100vw-1rem))] p-0"
          align="center"
        >
          <Command>
            <CommandInput placeholder={t('runs', 'worklistSearch')} />
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b">
              {t('runs', 'worklistPosition').replace('{{n}}', String(idx + 1)).replace('{{m}}', String(articles.length))}
            </div>
            <CommandList>
              <CommandGroup>
                {articles.map(article => (
                  <CommandItem
                    key={article.id}
                    value={article.title}
                    className={cn(
                      'truncate',
                      article.id === currentId && 'bg-info/10',
                    )}
                    onSelect={() => handleSelect(article.id)}
                  >
                    <span className="truncate">{article.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        aria-label={t('runs', 'articleNext')}
        disabled={!hasNext}
        onClick={() => hasNext && onNavigate(articles[idx + 1].id)}
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
      </Button>
    </div>
  );
}
