/**
 * Input de Item de Assessment
 *
 * Componente que renderiza input apropriado para um item de avaliação (assessment):
 * - Radio buttons para níveis permitidos (Low Risk, High Risk, etc.)
 * - Textarea para comentários/justificativas (opcional)
 * - Exibe guidance (orientação) do item
 * - Mostra sugestões de IA quando disponíveis
 *
 * Baseado em FieldInput.tsx, mas simplificado para items de assessment (DRY + KISS)
 *
 * @component
 */

import { useState, memo } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertCircle, Info, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { AssessmentItem, AIAssessmentSuggestion, AssessmentResponse } from '@/types/assessment';
import { Card } from '@/components/ui/card';
import { AISuggestionInline } from './ai/AISuggestionInline';
import { AISuggestionEvidence } from './ai/AISuggestionEvidence';
import { formatAssessmentLevel } from '@/lib/assessment-utils';

// =================== INTERFACES ===================

interface AssessmentItemInputProps {
  item: AssessmentItem;
  value: AssessmentResponse | null;
  onChange: (value: AssessmentResponse) => void;
  aiSuggestion?: AIAssessmentSuggestion;
  onAcceptAI?: () => Promise<void>;
  onRejectAI?: () => Promise<void>;
  onTriggerAI?: () => Promise<void>;
  isActionLoading?: boolean;
  isTriggerLoading?: boolean;
  disabled?: boolean;
}

// =================== COMPONENT ===================

export function AssessmentItemInput(props: AssessmentItemInputProps) {
  const {
    item,
    value,
    onChange,
    aiSuggestion,
    onAcceptAI,
    onRejectAI,
    onTriggerAI,
    isActionLoading,
    isTriggerLoading,
    disabled,
  } = props;

  const [showGuidance, setShowGuidance] = useState(false);

  // Estado local para edição
  const selectedLevel = value?.selected_level ?? '';
  const notes = value?.notes ?? '';

  // Determinar se há sugestão pendente
  const hasPendingSuggestion = aiSuggestion?.status === 'pending';
  const hasAcceptedSuggestion = aiSuggestion?.status === 'accepted';

  // Handler para mudança de nível
  const buildResponse = (
    overrides: Partial<AssessmentResponse>
  ): AssessmentResponse => ({
    item_id: item.id,
    selected_level: value?.selected_level ?? '',
    notes: value?.notes ?? null,
    confidence: value?.confidence ?? null,
    evidence: value?.evidence ?? [],
    ...overrides,
  });

  const handleLevelChange = (level: string) => {
    onChange(
      buildResponse({
        selected_level: level,
        notes,
      })
    );
  };

  // Handler para mudança de notas
  const handleNotesChange = (newNotes: string) => {
    onChange(
      buildResponse({
        selected_level: selectedLevel,
        notes: newNotes,
      })
    );
  };

  // Validação
  const hasError = item.is_required && !selectedLevel;

  return (
    <div className="grid grid-cols-[30%_1fr] gap-6 py-6 items-start border-b border-slate-100 last:border-b-0">
      {/* Coluna esquerda: Label + Código + Guidance */}
      <div className="space-y-2 pt-2">
        <div className="flex items-start justify-between gap-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{item.item_code}</span>
            {item.is_required && <span className="text-destructive">*</span>}
          </Label>
          {item.guidance && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 p-0"
                  onClick={() => setShowGuidance(!showGuidance)}
                >
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Ver orientação</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <p className="text-sm text-foreground leading-relaxed">{item.question}</p>

        {/* Guidance expandível */}
        {showGuidance && item.guidance && (
          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
            <p className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed whitespace-pre-wrap">
              {item.guidance}
            </p>
          </div>
        )}
      </div>

      {/* Coluna direita: Input */}
      <div className="space-y-3">
        {/* AI Trigger Button - mostrar se não houver sugestão ou se foi rejeitada */}
        {onTriggerAI && (!aiSuggestion || aiSuggestion.status === 'rejected') && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={onTriggerAI}
              disabled={isTriggerLoading || disabled}
              className="gap-2"
            >
              {isTriggerLoading ? (
                <>
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Avaliando com IA...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Avaliar com IA
                </>
              )}
            </Button>
          </div>
        )}

        {/* AI Suggestion Display - apenas se pendente */}
        {hasPendingSuggestion && aiSuggestion && (
          <Card className="p-4 bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
            <div className="space-y-4">
              {/* Header com badge e valor sugerido */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-purple-100 dark:bg-purple-900">
                      <Sparkles className="h-3 w-3 mr-1" />
                      IA sugere
                    </Badge>
                  </div>

                  <p className="text-sm font-medium mb-2">
                    Nível: <span className="text-purple-700 dark:text-purple-300">
                      {formatAssessmentLevel(aiSuggestion.suggested_value.level)}
                    </span>
                  </p>

                  {/* Inline suggestion component */}
                  <AISuggestionInline
                    suggestion={aiSuggestion}
                    onAccept={onAcceptAI}
                    onReject={onRejectAI}
                    loading={isActionLoading}
                  />
                </div>
              </div>

              {/* Evidence passages usando componente rico */}
              {aiSuggestion.suggested_value.evidence_passages && aiSuggestion.suggested_value.evidence_passages.length > 0 && (
                <div className="space-y-2">
                  {aiSuggestion.suggested_value.evidence_passages.slice(0, 2).map((passage, idx) => (
                    <AISuggestionEvidence
                      key={idx}
                      evidence={{
                        text: passage.text,
                        pageNumber: passage.page_number ?? null,
                      }}
                      showCopyButton
                    />
                  ))}
                  {aiSuggestion.suggested_value.evidence_passages.length > 2 && (
                    <p className="text-xs text-muted-foreground italic">
                      + {aiSuggestion.suggested_value.evidence_passages.length - 2} evidências adicionais
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Accepted suggestion badge */}
        {hasAcceptedSuggestion && !selectedLevel && (
          <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300">
            <Badge variant="outline" className="bg-green-100 dark:bg-green-900">
              <Sparkles className="h-3 w-3 mr-1" />
              Sugestão aceita
            </Badge>
          </div>
        )}

        {/* Radio buttons para níveis */}
        <div>
          <RadioGroup
            value={selectedLevel}
            onValueChange={handleLevelChange}
            disabled={disabled}
            className={cn(
              "space-y-2",
              hasError && "border-l-2 border-destructive pl-3"
            )}
          >
            {item.allowed_levels.map((level) => (
              <div key={level} className="flex items-center space-x-2">
                <RadioGroupItem value={level} id={`${item.id}-${level}`} />
                <Label
                  htmlFor={`${item.id}-${level}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {level}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Textarea para notas */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Comentário/Justificativa (opcional)
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Adicione comentários ou justificativas para esta avaliação..."
            disabled={disabled}
            className="text-sm min-h-[80px]"
          />
        </div>

        {/* Validation error */}
        {hasError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Este item é obrigatório
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Exporta versão memoizada para evitar re-renders desnecessários
 */
export default memo(AssessmentItemInput, (prevProps, nextProps) => {
  const aiSuggestionChanged =
    prevProps.aiSuggestion?.id !== nextProps.aiSuggestion?.id ||
    prevProps.aiSuggestion?.status !== nextProps.aiSuggestion?.status;

  return (
    prevProps.item.id === nextProps.item.id &&
    JSON.stringify(prevProps.value) === JSON.stringify(nextProps.value) &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.isActionLoading === nextProps.isActionLoading &&
    prevProps.isTriggerLoading === nextProps.isTriggerLoading &&
    !aiSuggestionChanged
  );
});
