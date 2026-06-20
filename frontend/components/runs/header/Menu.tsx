import type { ReactNode } from 'react';
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
