/**
 * Componente Inline de Sugestão de IA - Assessment
 *
 * Mostra sugestão ao lado do campo de input de forma minimalista
 * Layout responsivo: [%] [✓] [✗] [Valor truncado]
 *
 * Adaptado de extraction/ai/AISuggestionInline.tsx
 *
 * @component
 */

import type { AIAssessmentSuggestion } from '@/types/assessment';
import { AISuggestionActions } from './shared/AISuggestionActions';
import { AISuggestionConfidence } from './shared/AISuggestionConfidence';
import { AISuggestionValue } from './shared/AISuggestionValue';
import { isAssessmentSuggestionAccepted } from '@/types/assessment';

// =================== INTERFACES ===================

interface AISuggestionInlineProps {
  itemId: string;
  suggestion: AIAssessmentSuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionInline({
  suggestion,
  onAccept,
  onReject,
  loading = false,
}: AISuggestionInlineProps) {
  const isAccepted = isAssessmentSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200 flex-wrap">
      {/* Porcentagem + Botões de ação - mostrar se pendente ou rejeitado */}
      {!isAccepted && (
        <div className="flex items-center gap-2 shrink-0">
          <AISuggestionConfidence suggestion={suggestion} showDetailsOnClick />
          <AISuggestionActions
            onAccept={onAccept}
            onReject={onReject}
            loading={loading}
            isAccepted={isAccepted}
            isRejected={isRejected}
          />
        </div>
      )}

      {/* Badge quando aceita */}
      {isAccepted && (
        <span className="text-xs font-medium text-muted-foreground px-1.5 py-0.5 rounded">
          IA aceita
        </span>
      )}

      {/* Valor Sugerido */}
      <div className="flex-1 min-w-0 sm:max-w-[200px]">
        <AISuggestionValue suggestion={suggestion} maxLength={40} />
      </div>
    </div>
  );
}
