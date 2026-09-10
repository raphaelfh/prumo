/**
 * The run form's section navigation, shared by extraction and QA.
 *
 * Owns what the two screens must not re-implement:
 * - the rail's visibility — binary, the rail or nothing (never a strip),
 *   remembered in this browser, toggled by its button or ⌘\;
 * - which sections are open (`SectionOpenContext`), so picking a section in the
 *   rail, or jumping to a required field inside a closed one, opens it;
 * - the form column the "next required field" jump walks, bound to ⌘↵ from
 *   anywhere, including inside a field (a chord types nothing).
 *
 * Bindings go through `useKeyboardShortcuts`, so an open dialog or popover — the
 * review popover included — swallows them. `RUN_SHORTCUTS` documents them beside
 * the header's own.
 */
import { type ReactNode, useRef, useState } from 'react';
import { ListTree } from 'lucide-react';
import SectionNavRail from '@/components/extraction/SectionNavRail';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { useRunEditability } from '@/components/runs/RunEditabilityContext';
import { SectionOpenContext, type SectionOpenState } from '@/components/runs/SectionOpenContext';
import { KbdBadge } from '@/components/ui/kbd-badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useJumpToNextPendingField } from '@/hooks/extraction/useJumpToNextPendingField';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { t } from '@/lib/copy';
import { globalProgressFromRegistry, type SectionNavItem } from '@/lib/extraction/sectionRegistry';
import { ariaKeyShortcuts } from '@/lib/platform';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'prumo:run:section-nav:open';
const TOGGLE_KEYS = ['mod', '\\'];

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
}

export interface SectionNavLayoutProps {
  items: SectionNavItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** The form. Its column is the only region the jump walks. */
  children: ReactNode;
}

export function SectionNavLayout({ items, activeId, onSelect, children }: SectionNavLayoutProps) {
  const [railOpen, setRailOpen] = useState(readStoredOpen);
  const toggleRail = () => {
    writeStoredOpen(!railOpen);
    setRailOpen(!railOpen);
  };

  const [openById, setOpenById] = useState<Record<string, boolean>>({});
  const sectionOpen: SectionOpenState = {
    isOpen: (id, byDefault) => openById[id] ?? byDefault,
    setOpen: (id, open) => setOpenById((prev) => ({ ...prev, [id]: open })),
  };

  const { readOnly } = useRunEditability();
  const formColumnRef = useRef<HTMLDivElement>(null);
  const jumpToNextPending = useJumpToNextPendingField(formColumnRef, {
    pendingIds: new Set(items.filter((i) => i.requiredFilled < i.requiredTotal).map((i) => i.id)),
    open: (id) => sectionOpen.setOpen(id, true),
  });
  // The rail's jump button hides on the same condition.
  const canJump = !readOnly && globalProgressFromRegistry(items).requiredLeft > 0;

  useKeyboardShortcuts({
    bindings: [
      { type: 'chord', key: '\\', mod: true, handler: toggleRail },
      {
        type: 'chord',
        key: 'Enter',
        mod: true,
        handler: () => {
          if (canJump) jumpToNextPending();
        },
      },
    ],
    enabled: true,
  });

  const toggleLabel = t('runs', railOpen ? 'sectionNavHide' : 'sectionNavShow');

  return (
    <SectionOpenContext.Provider value={sectionOpen}>
      <div className={cn('flex', railOpen ? 'gap-4' : 'gap-2')}>
        {/* One toggle element in both states, so keyboard focus survives the switch. */}
        <div
          className={cn(
            'sticky top-0 flex flex-col self-start',
            railOpen && 'w-[184px] border-r border-border/40 bg-muted/30 py-2',
          )}
        >
          <div className={cn(railOpen && 'px-1.5 pb-1')}>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HeaderIconButton
                    type="button"
                    onClick={toggleRail}
                    aria-expanded={railOpen}
                    aria-label={toggleLabel}
                    aria-keyshortcuts={ariaKeyShortcuts(TOGGLE_KEYS)}
                    className={cn(railOpen && 'text-foreground')}
                  >
                    <ListTree strokeWidth={1.5} />
                  </HeaderIconButton>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex items-center gap-2">
                  <span>{toggleLabel}</span>
                  <KbdBadge keys={TOGGLE_KEYS} />
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {railOpen && (
            <SectionNavRail
              items={items}
              activeId={activeId}
              onSelect={(id) => {
                sectionOpen.setOpen(id, true);
                onSelect(id);
              }}
              onJumpToNextPending={jumpToNextPending}
            />
          )}
        </div>
        <div ref={formColumnRef} className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </SectionOpenContext.Provider>
  );
}
