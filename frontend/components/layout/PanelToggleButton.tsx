import {
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { IconButton } from '@/components/patterns/IconButton';
import { type KbdKey } from '@/components/ui/kbd-badge';
import { cn } from '@/lib/utils';

interface PanelToggleButtonProps {
  /** Which edge the panel opens from. `'bottom'` is the stacked (below-lg)
   *  layout, where the docked panel sits underneath instead of beside. */
  side: 'left' | 'right' | 'bottom';
  pressed: boolean;
  onToggle: () => void;
  /** Accessible name, and the text of the tooltip shown on hover and focus. */
  ariaLabel: string;
  /**
   * The chord this caller's screen actually binds, as KbdBadge keys (e.g.
   * `['mod', 'B']`). ONE value feeds both the tooltip chip and
   * `aria-keyshortcuts`, so what is shown and what is announced cannot drift.
   * It used to be derived from `side` — 'Meta+B' for left, '\\' otherwise —
   * which conflated a shortcut with a geometry: '\\' was bound only by
   * `useRunShortcuts`, so the articles panel toggles promised a key nothing
   * handled there. Screen readers announce it, so a wrong value is worse than
   * none. Opt in; never infer.
   */
  shortcut?: KbdKey[];
  /** Extra classes on the button itself (e.g. responsive gating like
   *  `hidden lg:inline-flex`). Merged after the base via cn. */
  className?: string;
}

const GLYPHS: Record<PanelToggleButtonProps['side'], {Close: typeof PanelLeftClose; Open: typeof PanelLeftOpen}> = {
  left: {Close: PanelLeftClose, Open: PanelLeftOpen},
  right: {Close: PanelRightClose, Open: PanelRightOpen},
  bottom: {Close: PanelBottomClose, Open: PanelBottomOpen},
};

// One component for the previously-duplicated header toggles (Topbar sidebar
// toggle, RunHeader SidebarToggle, RunHeader PanelToggle, the articles panel).
// `pressed` = panel/sidebar OPEN; the "Close" glyph shows when open.
export function PanelToggleButton({ side, pressed, onToggle, ariaLabel, shortcut, className }: PanelToggleButtonProps) {
  const {Close, Open} = GLYPHS[side];
  return (
    <IconButton
      label={ariaLabel}
      shortcut={shortcut}
      side="bottom"
      onClick={onToggle}
      aria-pressed={pressed}
      className={cn('relative', className)}
      icon={
        <span className="relative block h-4 w-4">
          <Close
            strokeWidth={1.5}
            className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-100' : 'opacity-0')}
            aria-hidden="true"
          />
          <Open
            strokeWidth={1.5}
            className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-0' : 'opacity-100')}
            aria-hidden="true"
          />
        </span>
      }
    />
  );
}
