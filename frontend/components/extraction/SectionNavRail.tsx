// frontend/components/extraction/SectionNavRail.tsx
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunEditability } from '@/components/runs/RunEditabilityContext';
import {
  globalProgressFromRegistry,
  type SectionNavItem,
  type SectionNavState,
} from '@/lib/extraction/sectionRegistry';

export interface SectionNavRailProps {
  items: SectionNavItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
  /**
   * Scroll to (and focus) the next required field still waiting for an answer.
   * Optional: without it the rail keeps its counters and simply omits the control.
   */
  onJumpToNextPending?: () => void;
}

const DOT_COLOR: Record<SectionNavState, string> = {
  complete: 'bg-success',
  in_progress: 'bg-info',
  empty: 'bg-muted-foreground/40',
};

export default function SectionNavRail({
  items,
  activeId,
  onSelect,
  collapsed,
  onJumpToNextPending,
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
      className={cn(
        'sticky top-0 self-start flex flex-col bg-muted/30 border-r border-border/40 py-2',
        collapsed ? 'w-11 items-center' : 'w-[184px]',
      )}
    >
      <ul className="flex-1 space-y-px">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
                title={collapsed ? `${item.label} — ${item.requiredFilled}/${item.requiredTotal}` : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground',
                  'hover:bg-muted/40 duration-75 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  item.level === 1 && !collapsed && 'pl-6',
                  isActive && 'bg-info/10 text-foreground',
                )}
              >
                <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', DOT_COLOR[item.state])} aria-hidden="true" />
                {!collapsed && (
                  <>
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                      {item.requiredFilled}/{item.requiredTotal}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {(showJump || (!collapsed && !readOnly)) && (
        <div className={cn('mt-2 border-t border-border/40 pt-2', collapsed ? 'w-full px-1' : 'px-2.5')}>
          {!collapsed && !readOnly && (
            <>
              <Progress value={global.percentage} className="h-1" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {global.requiredLeft > 0
                  ? t('extraction', 'sectionNavRequiredLeft').replace('{{count}}', String(global.requiredLeft))
                  : t('extraction', 'sectionNavComplete')}
              </p>
            </>
          )}
          {showJump && (
            // Local provider: the rail is mounted deep in the form tree and
            // cannot assume a caller-supplied TooltipProvider (same reason the
            // disposition row in FieldInput carries its own).
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {collapsed ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={onJumpToNextPending}
                      aria-label={t('extraction', 'sectionNavJumpNext')}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onJumpToNextPending}
                      className="mt-2 h-7 w-full justify-start gap-1.5 px-2 text-[11px] font-normal"
                    >
                      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t('extraction', 'sectionNavJumpNext')}</span>
                    </Button>
                  )}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{t('extraction', 'sectionNavJumpNextHint')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
    </nav>
  );
}
