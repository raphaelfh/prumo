/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * PDFViewer - Componente principal do visualizador de PDF
 * 
 * Container de alto nível que orquestra:
 * - Toolbar de controles
 * - Core do viewer (PDFViewerCore)
 * - Search panel overlay
 */

import { PDFToolbar } from './PDFToolbar';
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
        {/* PDF Viewer Core - Ocupa todo o espaço */}
        <div className="flex-1 w-full">
          <PDFViewerCore articleId={articleId} projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
