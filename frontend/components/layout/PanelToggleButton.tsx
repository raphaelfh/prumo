import {
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { cn } from '@/lib/utils';

interface PanelToggleButtonProps {
  /** Which edge the panel opens from. `'bottom'` is the stacked (below-lg)
   *  layout, where the docked panel sits underneath instead of beside. */
  side: 'left' | 'right' | 'bottom';
  pressed: boolean;
  onToggle: () => void;
  ariaLabel: string;
  /**
   * `aria-keyshortcuts` value, ONLY for a caller whose screen actually binds
   * that key. This used to be derived from `side` — 'Meta+B' for left, '\\'
   * otherwise — which conflated a shortcut with a geometry. Cmd+B is real for
   * the two sidebar toggles (`useNavigationShortcuts` via AppShell,
   * `RunWorkspaceShell` on the run screens) but '\\' is bound only by
   * `useRunShortcuts`, so the articles panel toggles inherited a promise of a
   * key nothing handles there. Screen readers announce these, so a wrong value
   * is worse than none. Opt in; never infer.
   */
  keyShortcuts?: string;
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
export function PanelToggleButton({ side, pressed, onToggle, ariaLabel, keyShortcuts, className }: PanelToggleButtonProps) {
  const {Close, Open} = GLYPHS[side];
  return (
    <HeaderIconButton
      onClick={onToggle}
      aria-pressed={pressed}
      aria-keyshortcuts={keyShortcuts}
      aria-label={ariaLabel}
      className={cn('relative', className)}
    >
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
    </HeaderIconButton>
  );
}
