/**
 * PDF panel for extraction
 *
 * Isolated component that manages the PDF viewer in the extraction interface.
 * Extracted from ExtractionFullScreen for modularity and reuse.
 * 
 * @component
 */

import {memo} from 'react';
import {ResizableHandle, ResizablePanel} from '@/components/ui/resizable';
import {PDFViewer} from '@/components/PDFViewer';

// =================== INTERFACES ===================

export interface ExtractionPDFPanelProps {
  articleId: string;
  projectId: string;
  showPDF: boolean;
}

// =================== COMPONENT ===================

/**
 * Memoized PDF panel to avoid unnecessary re-renders
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

// Memoize to avoid re-renders when props unchanged
export const ExtractionPDFPanel = memo(ExtractionPDFPanelComponent, (prevProps, nextProps) => {
  return (
    prevProps.articleId === nextProps.articleId &&
    prevProps.projectId === nextProps.projectId &&
    prevProps.showPDF === nextProps.showPDF
  );
});

ExtractionPDFPanel.displayName = 'ExtractionPDFPanel';

