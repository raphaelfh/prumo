/**
 * PDF panel for Assessment (Quality Assessment)
 *
 * Isolated component that manages the PDF viewer in the assessment interface.
 * Extracted from AssessmentFullScreen for modularity and reuse (SRP).
 *
 * Based on ExtractionPDFPanel.tsx (DRY + KISS)
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
 * Memoized PDF panel to avoid unnecessary re-renders
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

// Memoize to avoid re-renders when props don't change
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
