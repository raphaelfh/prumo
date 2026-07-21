import { Children, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
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
        <HeaderIconButton aria-label={t('runs', 'more')}>
          <MoreHorizontal strokeWidth={1.5} aria-hidden="true" />
        </HeaderIconButton>
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
