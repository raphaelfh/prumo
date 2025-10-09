/**
 * Sidebar - Container da sidebar com animação de colapso
 * 
 * Toggle movido para o header da toolbar (MainToolbar)
 * Usa o SidebarContainer modular internamente.
 */

import { usePDFStore } from '@/stores/usePDFStore';
import { cn } from '@/lib/utils';
import { SidebarContainer } from './sidebar/SidebarContainer';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { sidebarCollapsed } = usePDFStore();

  return (
    <div
      className={cn(
        'transition-all duration-300 ease-in-out overflow-hidden',
        sidebarCollapsed ? 'w-0' : 'w-[280px]',
        className
      )}
    >
      <SidebarContainer />
    </div>
  );
}
