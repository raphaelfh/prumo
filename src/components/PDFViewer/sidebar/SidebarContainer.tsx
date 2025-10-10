/**
 * SidebarContainer - Container unificado com tabs para diferentes painéis
 * 
 * Responsabilidades:
 * - Gerenciar tabs de navegação entre painéis
 * - Controlar a exibição de cada painel
 * - Manter o estado de qual painel está ativo
 * - Responsividade e colapso da sidebar
 */

import { FileText, List, Paperclip, MessageSquare, Bookmark } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ThumbnailsPanel } from './ThumbnailsPanel';
import { OutlinePanel } from './OutlinePanel';
import { AttachmentsPanel } from './AttachmentsPanel';
import { AnnotationsPanel } from './AnnotationsPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { usePDFStore } from '@/stores/usePDFStore';

interface SidebarContainerProps {
  className?: string;
}

export function SidebarContainer({ className }: SidebarContainerProps) {
  const { sidebarView, setSidebarView } = usePDFStore();

  // Mapping dos views para as tabs
  const tabsMapping = {
    thumbnails: 'thumbs',
    annotations: 'notes',
  } as const;

  const currentTab = tabsMapping[sidebarView] || 'thumbs';

  const handleTabChange = (value: string) => {
    // Mapear de volta para o sidebarView
    if (value === 'thumbs') setSidebarView('thumbnails');
    else if (value === 'notes') setSidebarView('annotations');
  };

  return (
    <div className={`w-full h-full border-r bg-background flex flex-col ${className || ''}`}>
      <Tabs value={currentTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        {/* Tabs de Navegação */}
        <TabsList className="grid grid-cols-5 rounded-none border-b">
          <TabsTrigger value="thumbs" className="data-[state=active]:bg-background">
            <FileText className="h-4 w-4" />
            <span className="sr-only">Miniaturas</span>
          </TabsTrigger>
          <TabsTrigger value="outline" className="data-[state=active]:bg-background" disabled>
            <List className="h-4 w-4" />
            <span className="sr-only">Sumário</span>
          </TabsTrigger>
          <TabsTrigger value="attach" className="data-[state=active]:bg-background" disabled>
            <Paperclip className="h-4 w-4" />
            <span className="sr-only">Anexos</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="data-[state=active]:bg-background">
            <MessageSquare className="h-4 w-4" />
            <span className="sr-only">Anotações</span>
          </TabsTrigger>
          <TabsTrigger value="bookmarks" className="data-[state=active]:bg-background" disabled>
            <Bookmark className="h-4 w-4" />
            <span className="sr-only">Marcadores</span>
          </TabsTrigger>
        </TabsList>

        {/* Conteúdo dos Painéis */}
        <div className="flex-1 overflow-hidden">
          <TabsContent value="thumbs" className="h-full m-0">
            <ThumbnailsPanel />
          </TabsContent>

          <TabsContent value="outline" className="h-full m-0">
            <OutlinePanel />
          </TabsContent>

          <TabsContent value="attach" className="h-full m-0">
            <AttachmentsPanel />
          </TabsContent>

          <TabsContent value="notes" className="h-full m-0">
            <AnnotationsPanel />
          </TabsContent>

          <TabsContent value="bookmarks" className="h-full m-0">
            <BookmarksPanel />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

