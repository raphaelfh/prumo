/**
 * Shared shell for the AI-suggestion popovers (details + history).
 *
 * Owns the solid surface, consistent header, responsive width, and a single
 * scrollable body region so the two popovers don't drift on chrome. The caller
 * wraps it in <Popover> + <PopoverTrigger> and supplies the body.
 */
import {PopoverContent} from '@/components/ui/popover';

interface AIPopoverShellProps {
  icon: React.ReactNode;
  title: string;
  count?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: React.ReactNode;
}

export function AIPopoverShell({
  icon,
  title,
  count,
  align = 'start',
  className,
  children,
}: AIPopoverShellProps) {
  return (
    <PopoverContent
      align={align}
      side="bottom"
      className={`w-[min(380px,calc(100vw-1.5rem))] overflow-hidden p-0 ${className ?? ''}`}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ai">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          {count != null && (
            <div className="text-xs text-muted-foreground">{count}</div>
          )}
        </div>
      </div>
      <div className="max-h-[min(70vh,32rem)] overflow-y-auto">{children}</div>
    </PopoverContent>
  );
}
