/**
 * Painel de Formulário para Assessment (Avaliação de Qualidade)
 *
 * Componente isolado que gerencia o formulário de assessment.
 * Extraído do AssessmentFullScreen para modularidade e reutilização (SRP).
 *
 * Baseado em ExtractionFormPanel.tsx (DRY + KISS)
 *
 * @component
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { AssessmentFormView } from './AssessmentFormView';
import type { AssessmentFormViewProps } from './AssessmentFormView';

// =================== INTERFACES ===================

export interface AssessmentFormPanelProps {
  formViewProps: AssessmentFormViewProps;
}

// =================== COMPONENT ===================

/**
 * Painel de formulário de assessment
 * Simplifica o AssessmentFullScreen ao extrair lógica de renderização
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
