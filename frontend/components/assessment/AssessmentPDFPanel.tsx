/**
 * Painel de PDF para Assessment (Avaliação de Qualidade)
 *
 * Componente isolado que gerencia o PDF viewer na interface de assessment.
 * Extraído do AssessmentFullScreen para modularidade e reutilização (SRP).
 *
 * Baseado em ExtractionPDFPanel.tsx (DRY + KISS)
 *
 * @component
 */

import {memo} from 'react';
import {ResizableHandle, ResizablePanel} from '@/components/ui/resizable';
import {PDFViewer} from '@/components/PDFViewer';

// =================== INTERFACES ===================

export interface AssessmentPDFPanelProps {
  articleId: string;
  projectId: string;
  showPDF: boolean;
}

// =================== COMPONENT ===================

/**
 * Painel de PDF memoizado para evitar re-renders desnecessários
 */
function AssessmentPDFPanelComponent({
  articleId,
  projectId,
  showPDF,
}: AssessmentPDFPanelProps) {
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
export const AssessmentPDFPanel = memo(
  AssessmentPDFPanelComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.articleId === nextProps.articleId &&
      prevProps.projectId === nextProps.projectId &&
      prevProps.showPDF === nextProps.showPDF
    );
  }
);

AssessmentPDFPanel.displayName = 'AssessmentPDFPanel';
