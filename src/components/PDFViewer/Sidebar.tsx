/**
 * Sidebar - Container da sidebar com animação de colapso
 * 
 * Toggle movido para o header da toolbar (MainToolbar)
 * Usa o SidebarContainer modular internamente.
 * 
 * Comportamento:
 * - Posição absoluta para sobrepor o PDF
 * - Animação suave de slide
 * - Sempre acessível (mobile e desktop)
 * - Largura responsiva (280px desktop, 320px mobile)
 */

import { usePDFStore } from '@/stores/usePDFStore';
import { cn } from '@/lib/utils';
import { SidebarContainer } from './sidebar/SidebarContainer';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { sidebarCollapsed, toggleSidebar } = usePDFStore();

  return (
    <>
      {/* Overlay backdrop - apenas mobile */}
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}
      
      {/* Sidebar */}
      <div
        className={cn(
          'absolute top-0 left-0 bottom-0 z-50',
          'transition-transform duration-300 ease-in-out',
          'w-[320px] md:w-[340px] lg:w-[360px]',
          'shadow-2xl lg:shadow-xl',
          sidebarCollapsed ? '-translate-x-full' : 'translate-x-0',
          className
        )}
      >
        <div className="relative h-full">
          {/* Botão fechar - mobile */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 lg:hidden"
            onClick={toggleSidebar}
          >
            <X className="h-4 w-4" />
          </Button>
          
          <SidebarContainer />
        </div>
      </div>
    </>
  );
}
