/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

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
import { SearchTool } from './SearchTool';
import { MoreTools } from './MoreTools';
import { Separator } from '@/components/ui/separator';

export function MainToolbar() {
  return (
    <div className="flex items-center gap-1 p-2 border-b bg-background flex-wrap shadow-sm">

      {/* Navegação de Páginas */}
      <NavigationTools />

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Controles de Zoom */}
      <ZoomTools />

      <Separator orientation="vertical" className="h-6 hidden sm:block" />

      {/* Modos de Visualização */}
      <ViewModeTools />

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
