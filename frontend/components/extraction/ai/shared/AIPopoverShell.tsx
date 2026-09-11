/**
 * Shared shell for the AI-suggestion popovers (details + history).
 *
 * Owns the solid surface, consistent header, responsive width, and a single
 * scrollable body region so the two popovers don't drift on chrome. The caller
 * wraps it in <Popover> + <PopoverTrigger> and supplies the body.
 */
import {PopoverContent} from '@/components/ui/popover';
import {cn} from '@/lib/utils';

interface AIPopoverShellProps {
  icon: React.ReactNode;
  title: string;
  count?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: React.ReactNode;
  /** Optional strip pinned BELOW the scrollable body (e.g. Clear + a
   *  traceability note). Stays reachable no matter how long the body grows. */
  footer?: React.ReactNode;
}

export function AIPopoverShell({
  icon,
  title,
  count,
  align = 'start',
  className,
  children,
  footer,
}: AIPopoverShellProps) {
  return (
    <PopoverContent
      align={align}
      side="bottom"
      // Focus the surface, not its first button: auto-focusing an action (often
      // Clear, when a version has no details) pops that action's tooltip over
      // the content the moment the popover opens. Tab still reaches every action.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).focus();
      }}
      className={cn(
        // Bounded by the space Radix reports below/above the trigger, and by a
        // share of the viewport rather than a fixed cap, so the popover never
        // clips yet a tall screen shows more of a long rationale. A flex column
        // with a single scrollable body absorbs any content growth.
        'flex max-h-[min(var(--radix-popover-content-available-height),70vh)] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden p-0',
        className,
      )}
    >
      {/* One compact line: the header labels the content, it isn't the content. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ai">
          {icon}
        </span>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[13px] font-medium">{title}</span>
          {count != null && (
            <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer != null && <div className="shrink-0 border-t">{footer}</div>}
    </PopoverContent>
  );
}
