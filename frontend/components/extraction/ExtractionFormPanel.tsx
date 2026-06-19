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
import type {RunReviewerComparisonProps} from '@/components/runs/RunReviewerComparison';
import {RunReviewerComparison} from '@/components/runs/RunReviewerComparison';

// =================== INTERFACES ===================

export interface ExtractionFormPanelProps {
  viewMode: 'extract' | 'compare';
  showPDF: boolean;
  // Props for ExtractionFormView (extract mode)
  formViewProps?: ExtractionFormViewProps;
  // Props for the shared RunReviewerComparison (compare mode)
  compareViewProps?: RunReviewerComparisonProps;
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
    // data-scroll-container is consumed by usePreserveScroll so the form
    // keeps its scroll position around async refreshes (e.g. after AI
    // extraction). Pair the marker with the inner radix viewport selector
    // because radix ScrollArea renders the actual scroll node beneath.
    <div data-scroll-container="extraction-form" className="h-full">
      <ScrollArea className="h-full bg-muted/30">
        <div className="@container p-8 space-y-4">
          {viewMode === 'extract' && formViewProps ? (
            <ExtractionFormView {...formViewProps} showPDF={showPDF} />
          ) : viewMode === 'compare' && compareViewProps ? (
            <RunReviewerComparison {...compareViewProps} />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

