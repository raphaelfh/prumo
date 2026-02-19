/**
 * Componente de Exibição de Sugestão de IA
 * 
 * Mostra valor sugerido + botões aceitar/rejeitar abaixo do input
 * Layout responsivo: [Valor sugerido] [%] [✓] [↻] [✗]
 * 
 * @component
 */

import type { AISuggestion, AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';
import { AISuggestionActions } from '@/components/shared/ai-suggestions';
import { AISuggestionConfidence } from './shared/AISuggestionConfidence';
import { AISuggestionValue } from './shared/AISuggestionValue';
import { isSuggestionAccepted } from '@/lib/ai-extraction/suggestionUtils';

interface AISuggestionDisplayProps {
  suggestion: AISuggestion;
  instanceId: string;
  fieldId: string;
  onAccept?: () => void;
  onReject?: () => void;
  loading?: boolean;
  getHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  // getHistory mantido para compatibilidade, mas o botão foi movido para FieldInput
}

export function AISuggestionDisplay({
  suggestion,
  instanceId: _instanceId,
  fieldId: _fieldId,
  onAccept,
  onReject,
  loading = false,
  getHistory: _getHistory,
}: AISuggestionDisplayProps) {
  const isAccepted = isSuggestionAccepted(suggestion);
  const isRejected = suggestion.status === 'rejected';

  return (
    <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-200 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-2 w-full">
        {/* Valor Sugerido - ocupa espaço disponível */}
        <div className="flex-1 min-w-0 w-full sm:w-auto">
          <AISuggestionValue suggestion={suggestion} maxLength={150} />
        </div>

        {/* Porcentagem + Botões de ação - sempre mostrar (pendente, aceito ou rejeitado) */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end sm:justify-start pr-1">
          <AISuggestionConfidence suggestion={suggestion} showDetailsOnClick />
          
          <div className="overflow-visible">
            <AISuggestionActions
              onAccept={onAccept}
              onReject={onReject}
              loading={loading}
              isAccepted={isAccepted}
              isRejected={isRejected}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

