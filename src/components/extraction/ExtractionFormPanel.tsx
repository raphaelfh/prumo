/**
 * Painel de Formulário para Extração
 * 
 * Componente isolado que gerencia o formulário de extração (modo extract ou compare).
 * Extraído do ExtractionFullScreen para modularidade e reutilização.
 * 
 * @component
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { ExtractionFormView } from './ExtractionFormView';
import { ExtractionCompareView } from './ExtractionCompareView';
import type { ExtractionFormViewProps } from './ExtractionFormView';
import type { ExtractionCompareViewProps } from './ExtractionCompareView';

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
 * Painel de formulário que alterna entre modos extract e compare
 * Simplifica o ExtractionFullScreen ao extrair lógica de renderização
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

