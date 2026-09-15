// frontend/components/extraction/SectionNavRail.tsx
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { ariaKeyShortcuts } from '@/lib/platform';
import { IconButton } from '@/components/patterns/IconButton';
import { Button } from '@/components/ui/button';
import { KbdBadge } from '@/components/ui/kbd-badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunEditability } from '@/components/runs/RunEditabilityContext';
import {
  globalProgressFromRegistry,
  type SectionNavItem,
  type SectionNavState,
} from '@/lib/extraction/sectionRegistry';

export interface SectionNavRailProps {
  presentation?: 'review-table' | 'default';
  items: SectionNavItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /**
   * Scroll to (and focus) the next required field still waiting for an answer.
   * Optional: without it the rail keeps its counters and simply omits the control.
   */
  onJumpToNextPending?: () => void;
  /** Labels, counts and footer drop; each section stays as a status dot. */
  compact?: boolean;
}

const DOT_COLOR: Record<SectionNavState, string> = {
  complete: 'bg-success',
  in_progress: 'bg-info',
  empty: 'bg-muted-foreground/40',
};

/**
 * The section list. Its frame, width and show/hide toggle belong to
 * `SectionNavLayout`, which also binds the jump to ⌘↵ — hence the chord in the
 * jump button's tooltip.
 */
export default function SectionNavRail({
  items,
  activeId,
  onSelect,
  onJumpToNextPending,
  compact = false,
  presentation = 'default',
}: SectionNavRailProps) {
  // Read-only run: the "N required left" footer is a fill-completion CTA —
  // noise on a published view. Navigation (dots + labels) stays.
  const { readOnly } = useRunEditability();
  const global = globalProgressFromRegistry(items);
  // Counters tell you how many are missing; this is the affordance that takes
  // you to one. It rides the same read-only gate as the footer, and retires
  // once there is nothing left to answer.
  const showJump = !readOnly && !!onJumpToNextPending && global.requiredLeft > 0;
  return (
    <nav
      aria-label={t('extraction', 'sectionNavAria')}
      className={cn('flex flex-col', compact && 'items-center')}
    >
      <ul className={cn('flex-1 space-y-px', compact && 'flex flex-col items-center')}>
        {items.map((item) => {
          const isActive = item.id === activeId;
          const count = `${item.requiredFilled}/${item.requiredTotal}`;
          const row = (
            <button
              type="button"
              aria-current={isActive ? 'true' : undefined}
              aria-label={compact ? `${item.label} ${count}` : undefined}
              onClick={() => onSelect(item.id)}
              className={cn(
                'flex items-center rounded-md text-[13px] text-muted-foreground',
                'hover:bg-muted/40 duration-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                compact
                  ? 'h-6 w-6 justify-center'
                  : cn('w-full gap-2 px-2.5 py-1.5', item.level === 1 && 'pl-6'),
                isActive && 'bg-info/10 text-foreground',
              )}
            >
              {presentation !== 'review-table' && <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', DOT_COLOR[item.state])} aria-hidden="true" />}
              {!compact && (
                <>
                  <span className="truncate">{item.label}</span>
                  <span className={cn("ml-auto text-[11px] font-medium text-muted-foreground", presentation === 'review-table' && (item.state === 'complete' ? 'text-success' : item.state === 'in_progress' ? 'text-info' : 'text-muted-foreground'))}>{count}</span>
                </>
              )}
            </button>
          );
          return (
            <li key={item.id}>
              {compact ? (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>{row}</TooltipTrigger>
                  <TooltipContent side="right" className="flex items-center gap-2">
                    <span>{item.label}</span>
                    <span className="text-background/70">{count}</span>
                  </TooltipContent>
                </Tooltip>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
      {compact && showJump && (
        <div className="mt-1 border-t border-border/40 pt-1">
          <IconButton
            label={t('extraction', 'sectionNavJumpNext')}
            hint={t('extraction', 'sectionNavJumpNextHint')}
            shortcut={['mod', 'Enter']}
            side="right"
            size="icon-xs"
            onClick={onJumpToNextPending}
            icon={<ArrowDown strokeWidth={1.5} />}
          />
        </div>
      )}
      {!compact && !readOnly && presentation !== 'review-table' && (
        <div className="mt-2 border-t border-border/40 px-2.5 pt-2">
          <Progress value={global.percentage} className="h-1" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {global.requiredLeft > 0
              ? t('extraction', 'sectionNavRequiredLeft').replace('{{count}}', String(global.requiredLeft))
              : t('extraction', 'sectionNavComplete')}
          </p>
          {showJump && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onJumpToNextPending}
                    aria-keyshortcuts={ariaKeyShortcuts(['mod', 'Enter'])}
                    className="mt-2 w-full justify-start gap-1.5 px-2 text-[11px] font-normal"
                  >
                    <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t('extraction', 'sectionNavJumpNext')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex items-center gap-2">
                  <span>{t('extraction', 'sectionNavJumpNextHint')}</span>
                  <KbdBadge keys={['mod', '↵']} />
                </TooltipContent>
              </Tooltip>
          )}
        </div>
      )}
    </nav>
  );
}
