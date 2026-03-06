/**
 * Assessment form panel (quality assessment)
 *
 * Isolated component that manages the assessment form.
 * Extracted from AssessmentFullScreen for modularity and reuse (SRP).
 *
 * Baseado em ExtractionFormPanel.tsx (DRY + KISS)
 *
 * @component
 */

import {ScrollArea} from '@/components/ui/scroll-area';
import type {AssessmentFormViewProps} from './AssessmentFormView';
import {AssessmentFormView} from './AssessmentFormView';

// =================== INTERFACES ===================

export interface AssessmentFormPanelProps {
  formViewProps: AssessmentFormViewProps;
}

// =================== COMPONENT ===================

/**
 * Assessment form panel
 * Simplifies AssessmentFullScreen by extracting render logic
 */
export function AssessmentFormPanel({ formViewProps }: AssessmentFormPanelProps) {
  if (!formViewProps) {
    return null;
  }

  return (
    <ScrollArea className="h-full bg-slate-50">
      <div className="p-8 space-y-4">
        <AssessmentFormView {...formViewProps} />
      </div>
    </ScrollArea>
  );
}
