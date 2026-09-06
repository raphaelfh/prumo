import { Children, useState, type ReactNode } from 'react';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { NotificationCenter } from '@/components/navigation/NotificationCenter';
import { t } from '@/lib/copy';
import { Menu, MenuItem } from './Menu';
import { Help, HelpDialog } from './Help';
import { useHeaderCompact } from './useHeaderCompact';

interface UtilityProps {
  /**
   * Business-gated overflow items (compare toggle, reopen, …), rendered at the
   * TOP of the kebab, above the folded help item.
   */
  children?: ReactNode;
}

/**
 * Shared right-side utility cluster for the run header.
 *
 * The full-screen run pages have no global Topbar, so notifications + help must
 * live here. The cluster degrades by width to keep the bar from crowding:
 *
 * - **Bell** is inline at every width — its badge/active-job dot must stay
 *   glanceable, and nesting its dropdown inside the kebab is awkward.
 * - **Help** is inline when the header is wide and **folds into the kebab**
 *   ("three dots") when it is narrow. The fold is driven by a measured header
 *   width (`useHeaderCompact`) rather than a container query, because the kebab
 *   content is portaled out of the `@container/headerbar`.
 * - **Business items** (passed as children) always live in the kebab.
 *
 * `Menu` self-hides when it has no items, so a wide header with no business
 * items shows no kebab at all.
 *
 * Feedback is deliberately NOT here: the bug report has one home, the sidebar
 * footer next to the user name (`FeedbackButton`). On this screen that footer
 * starts unmounted — `RunWorkspaceShell` opens the shell `defaultCollapsed` —
 * so reaching it costs one ⌘B (or the header's own sidebar toggle) first. That
 * is the accepted price of a single entry point; re-adding a trigger here is
 * what this change removed.
 */
export function Utility({ children }: UtilityProps) {
  const { ref, compact } = useHeaderCompact();
  const [helpOpen, setHelpOpen] = useState(false);
  const hasBusinessItems = Children.toArray(children).length > 0;

  return (
    <>
      {/* Zero-footprint sentinel — anchors the width measurement to the header. */}
      <span ref={ref} aria-hidden="true" className="hidden" />
      {/* Separator before the cluster — only when items sit inline. */}
      {!compact && <span className="mx-1 h-5 w-px bg-border/60" aria-hidden="true" />}
      <NotificationCenter />
      {!compact && <Help />}
      <Menu>
        {children}
        {compact && hasBusinessItems && <DropdownMenuSeparator />}
        {compact && (
          <MenuItem onSelect={() => setHelpOpen(true)}>{t('runs', 'helpButton')}</MenuItem>
        )}
      </Menu>
      {helpOpen && <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />}
    </>
  );
}
