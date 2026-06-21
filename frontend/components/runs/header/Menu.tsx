import { Children, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/lib/copy';

interface MenuProps {
  children: ReactNode;
}

export function Menu({ children }: MenuProps) {
  // Conditional MenuItems collapse to `false`/`null` when their gate is off
  // (e.g. extraction with no comparison + cannot reopen). An always-mounted
  // trigger over an empty content set is a dead affordance — the kebab opened
  // to nothing. Children.toArray drops booleans/null, so when nothing survives
  // we render no trigger at all rather than an empty dropdown.
  if (Children.toArray(children).length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground"
          aria-label={t('runs', 'more')}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface MenuItemProps {
  onSelect: () => void;
  children: ReactNode;
}

export function MenuItem({ onSelect, children }: MenuItemProps) {
  return (
    <DropdownMenuItem onSelect={() => onSelect()}>
      {children}
    </DropdownMenuItem>
  );
}
