import { Children, useState, type ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { NotificationCenter } from '@/components/navigation/NotificationCenter';
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { t } from '@/lib/copy';
import { Menu, MenuItem } from './Menu';
import { Help, HelpDialog } from './Help';
import { useHeaderCompact } from './useHeaderCompact';

interface UtilityProps {
  /**
   * Business-gated overflow items (compare toggle, reopen, …), rendered at the
   * TOP of the kebab, above any folded feedback/help items.
   */
  children?: ReactNode;
}

/**
 * Shared right-side utility cluster for the run header.
 *
 * The full-screen run pages have no global Topbar, so notifications + feedback +
 * help must live here. The cluster degrades by width to keep the bar from
 * crowding:
 *
 * - **Bell** is inline at every width — its badge/active-job dot must stay
 *   glanceable, and nesting its dropdown inside the kebab is awkward.
 * - **Feedback + Help** are inline when the header is wide and **fold into the
 *   kebab** ("three dots") when it is narrow. The fold is driven by a measured
 *   header width (`useHeaderCompact`) rather than a container query, because the
 *   kebab content is portaled out of the `@container/headerbar`.
 * - **Business items** (passed as children) always live in the kebab.
 *
 * `Menu` self-hides when it has no items, so a wide header with no business
 * items shows no kebab at all.
 *
 * Feedback opens a single, lazily-mounted dialog shared by the inline trigger
 * and the folded menu item — it is NOT the self-contained `FeedbackButton`,
 * because that mounts its dialog (and thus its auth/mutation hooks) eagerly,
 * which would couple the whole run header to `AuthProvider` on first render.
 */
export function Utility({ children }: UtilityProps) {
  const { ref, compact } = useHeaderCompact();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const hasBusinessItems = Children.toArray(children).length > 0;

  return (
    <>
      {/* Zero-footprint sentinel — anchors the width measurement to the header. */}
      <span ref={ref} aria-hidden="true" className="hidden" />
      {/* Separator before the cluster — only when items sit inline. */}
      {!compact && <span className="mx-1 h-5 w-px bg-border/60" aria-hidden="true" />}
      <NotificationCenter />
      {!compact && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <HeaderIconButton onClick={() => setFeedbackOpen(true)} aria-label={t('navigation', 'sendFeedback')}>
                <MessageCircle strokeWidth={1.5} aria-hidden="true" />
              </HeaderIconButton>
            </TooltipTrigger>
            <TooltipContent>{t('navigation', 'sendFeedback')}</TooltipContent>
          </Tooltip>
          <Help />
        </>
      )}
      <Menu>
        {children}
        {compact && hasBusinessItems && <DropdownMenuSeparator />}
        {compact && (
          <MenuItem onSelect={() => setFeedbackOpen(true)}>{t('navigation', 'sendFeedback')}</MenuItem>
        )}
        {compact && (
          <MenuItem onSelect={() => setHelpOpen(true)}>{t('runs', 'helpButton')}</MenuItem>
        )}
      </Menu>
      {feedbackOpen && <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />}
      {helpOpen && <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />}
    </>
  );
}
