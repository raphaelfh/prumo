/**
 * PDFViewer - Componente principal do visualizador de PDF
 * 
 * Container de alto nível que orquestra:
 * - Toolbar de controles
 * - Sidebar com múltiplas views
 * - Core do viewer (PDFViewerCore)
 * - Search panel overlay
 */

import { PDFToolbar } from './PDFToolbar';
import { Sidebar } from './Sidebar';
import { PDFViewerCore } from './core/PDFViewerCore';
import { SearchPanel } from './search/SearchPanel';
import { usePDFStore } from '@/stores/usePDFStore';

interface PDFViewerProps {
  articleId: string;
  projectId: string;
  className?: string;
}

export function PDFViewer({ articleId, projectId, className }: PDFViewerProps) {
  const { ui } = usePDFStore();
  const searchOpen = ui?.searchOpen || false;

  return (
    <div className={`flex flex-col h-full relative ${className || ''}`}>
      {/* Toolbar */}
      <PDFToolbar />

      {/* Search Panel - Aparece logo abaixo da toolbar */}
      <SearchPanel 
        isOpen={searchOpen} 
        onClose={() => usePDFStore.getState().setSearchOpen(false)} 
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar - Desktop only */}
        <Sidebar className="hidden lg:flex" />

        {/* PDF Viewer Core */}
        <div className="flex-1">
          <PDFViewerCore articleId={articleId} projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
