/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Painel de PDF para Extração
 * 
 * Componente isolado que gerencia o PDF viewer na interface de extração.
 * Extraído do ExtractionFullScreen para modularidade e reutilização.
 * 
 * @component
 */

import { memo } from 'react';
import { ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { PDFViewer } from '@/components/PDFViewer';

// =================== INTERFACES ===================

export interface ExtractionPDFPanelProps {
  articleId: string;
  projectId: string;
  showPDF: boolean;
}

// =================== COMPONENT ===================

/**
 * Painel de PDF memoizado para evitar re-renders desnecessários
 */
function ExtractionPDFPanelComponent({ 
  articleId, 
  projectId, 
  showPDF 
}: ExtractionPDFPanelProps) {
  if (!showPDF) {
    return null;
  }

  return (
    <>
      <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
        <PDFViewer articleId={articleId} projectId={projectId} />
      </ResizablePanel>
      <ResizableHandle withHandle />
    </>
  );
}

// Memoizar para evitar re-renders quando props não mudam
export const ExtractionPDFPanel = memo(ExtractionPDFPanelComponent, (prevProps, nextProps) => {
  return (
    prevProps.articleId === nextProps.articleId &&
    prevProps.projectId === nextProps.projectId &&
    prevProps.showPDF === nextProps.showPDF
  );
});

ExtractionPDFPanel.displayName = 'ExtractionPDFPanel';

