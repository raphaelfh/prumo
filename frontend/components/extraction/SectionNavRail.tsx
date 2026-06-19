// frontend/components/extraction/SectionNavRail.tsx
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';
import { Progress } from '@/components/ui/progress';
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
}

const DOT_COLOR: Record<SectionNavState, string> = {
  complete: 'bg-success',
  in_progress: 'bg-info',
  empty: 'bg-muted-foreground/40',
};

export default function SectionNavRail({ items, activeId, onSelect, collapsed }: SectionNavRailProps) {
  const global = globalProgressFromRegistry(items);
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
                  'hover:bg-muted/40 duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
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
      {!collapsed && (
        <div className="mt-2 border-t border-border/40 px-2.5 pt-2">
          <Progress value={global.percentage} className="h-1" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {global.requiredLeft > 0
              ? t('extraction', 'sectionNavRequiredLeft').replace('{{count}}', String(global.requiredLeft))
              : t('extraction', 'sectionNavComplete')}
          </p>
        </div>
      )}
    </nav>
  );
}
