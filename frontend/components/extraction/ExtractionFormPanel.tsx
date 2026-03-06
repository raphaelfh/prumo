/**
 * Extraction form panel
 *
 * Isolated component that manages the extraction form (extract or compare mode).
 * Extracted from ExtractionFullScreen for modularity and reuse.
 * 
 * @component
 */

import {ScrollArea} from '@/components/ui/scroll-area';
import type {ExtractionFormViewProps} from './ExtractionFormView';
import {ExtractionFormView} from './ExtractionFormView';
import type {ExtractionCompareViewProps} from './ExtractionCompareView';
import {ExtractionCompareView} from './ExtractionCompareView';

// =================== INTERFACES ===================

export interface ExtractionFormPanelProps {
  viewMode: 'extract' | 'compare';
  showPDF: boolean;
  // Props para ExtractionFormView (modo extract)
  formViewProps?: ExtractionFormViewProps;
  // Props para ExtractionCompareView (modo compare)
  compareViewProps?: ExtractionCompareViewProps;
}

// =================== COMPONENT ===================

/**
 * Form panel that toggles between extract and compare modes
 * Simplifies ExtractionFullScreen by extracting render logic
 */
export function ExtractionFormPanel({
  viewMode,
  showPDF,
  formViewProps,
  compareViewProps,
}: ExtractionFormPanelProps) {
  if (!formViewProps && !compareViewProps) {
    return null;
  }

  return (
    <ScrollArea className="h-full bg-slate-50">
      <div className="p-8 space-y-4">
        {viewMode === 'extract' && formViewProps ? (
          <ExtractionFormView {...formViewProps} />
        ) : viewMode === 'compare' && compareViewProps ? (
          <ExtractionCompareView {...compareViewProps} />
        ) : null}
      </div>
    </ScrollArea>
  );
}

