/**
 * PDFViewer - Componente principal do visualizador de PDF
 *
 * Top-level container that orchestrates:
 * - Toolbar de controles
 * - Core do viewer (PDFViewerCore)
 * - Search panel overlay
 */

import {PDFToolbar} from './PDFToolbar';
import {PDFViewerCore} from './core/PDFViewerCore';
import {SearchPanel} from './search/SearchPanel';
import {usePDFStore} from '@/stores/usePDFStore';

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
          {/* PDF Viewer Core - fills space */}
        <div className="flex-1 w-full">
          <PDFViewerCore articleId={articleId} projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
