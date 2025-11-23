/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Componente Inline de Sugestão de IA
 * 
 * Mostra sugestão ao lado do campo de input de forma minimalista
 * Layout responsivo: [%] [✓] [✗] [Valor truncado]
 * 
 * @component
 */

import type { AISuggestion, AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';
import { AISuggestionHistoryPopover } from './AISuggestionHistoryPopover';
import { AISuggestionActions } from './shared/AISuggestionActions';
import { AISuggestionConfidence } from './shared/AISuggestionConfidence';
import { AISuggestionValue } from './shared/AISuggestionValue';
import { isSuggestionAccepted } from '@/lib/ai-extraction/suggestionUtils';

// =================== INTERFACES ===================

interface AISuggestionInlineProps {
  instanceId: string;
  fieldId: string;
  suggestion: AISuggestion;
  onAccept?: () => void;
  onReject?: () => void;
  getHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  loading?: boolean;
}

// =================== COMPONENT ===================

export function AISuggestionInline({
  instanceId,
  fieldId,
  suggestion,
  onAccept,
  onReject,
  getHistory,
  loading = false,
}: AISuggestionInlineProps) {
  const isAccepted = isSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200 flex-wrap">
      {/* Porcentagem + Botões de ação - mostrar se pendente ou rejeitado (para mostrar indicador) */}
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

      {/* Badge de confiança quando aceita (com histórico se disponível) */}
      {isAccepted && getHistory && (
        <AISuggestionHistoryPopover
          instanceId={instanceId}
          fieldId={fieldId}
          currentSuggestionId={suggestion.id}
          getHistory={getHistory}
          onAccept={() => onAccept?.()}
          onReject={() => onReject?.()}
          trigger={
            <span className="text-xs font-medium text-muted-foreground cursor-help px-1.5 py-0.5 rounded">
              IA aceita
            </span>
          }
        />
      )}

      {/* Valor Sugerido */}
      <div className="flex-1 min-w-0 sm:max-w-[200px]">
        <AISuggestionValue suggestion={suggestion} maxLength={40} />
      </div>
    </div>
  );
}

