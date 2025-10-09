/**
 * MainToolbar - Barra de ferramentas principal do PDFViewer
 * 
 * Responsabilidades:
 * - Orquestrar todas as ferramentas em um layout responsivo
 * - Gerenciar o estado de expansão/colapso
 * - Agrupar ferramentas por categoria
 */

import { NavigationTools } from './NavigationTools';
import { ZoomTools } from './ZoomTools';
import { ViewModeTools } from './ViewModeTools';
import { AnnotationTools } from './AnnotationTools';
import { SearchTool } from './SearchTool';
import { MoreTools } from './MoreTools';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { usePDFStore } from '@/stores/usePDFStore';

export function MainToolbar() {
  const { sidebarCollapsed, toggleSidebar } = usePDFStore();

  return (
    <div className="flex items-center gap-1 p-2 border-b bg-background flex-wrap shadow-sm">
      {/* Toggle Sidebar - Elegante e minimalista */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="h-8 w-8 mr-1"
        title={sidebarCollapsed ? 'Mostrar Sidebar' : 'Ocultar Sidebar'}
      >
        {sidebarCollapsed ? (
          <PanelLeft className="h-4 w-4" />
        ) : (
          <PanelLeftClose className="h-4 w-4" />
        )}
      </Button>

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Navegação de Páginas */}
      <NavigationTools />

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Controles de Zoom */}
      <ZoomTools />

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Modos de Visualização */}
      <ViewModeTools />

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Ferramentas de Anotação */}
      <AnnotationTools />

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Busca */}
      <SearchTool />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Mais Opções */}
      <MoreTools />
    </div>
  );
}

