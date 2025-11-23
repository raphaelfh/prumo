/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Input Universal de Campo de Extração
 * 
 * Componente que renderiza input apropriado baseado no tipo do campo:
 * - text: Input ou Textarea
 * - number: Input number + unit badge
 * - date: DatePicker
 * - select: Select dropdown
 * - multiselect: Multi-select
 * - boolean: Switch
 * 
 * Também mostra badges de IA e outras extrações (futuro).
 * 
 * @component
 */

import { useState, memo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SelectWithOther } from '@/components/ui/SelectWithOther';
import { MultiSelectWithOther } from '@/components/ui/MultiSelectWithOther';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ExtractionField } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';
import { OtherExtractionsPopover } from './colaboracao/OtherExtractionsPopover';
import { OtherExtractionsButton } from './colaboracao/OtherExtractionsButton';
import { AISuggestionDisplay } from './ai/AISuggestionDisplay';
import { AISuggestionBadge } from './ai/AISuggestionBadge';
import { AISuggestionHistoryPopover } from './ai/AISuggestionHistoryPopover';
import { getRelatedUnits } from '@/lib/unitConversions';
import type { AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';
import {
  extractValue,
  isEmptyValue,
  isValidNumber,
  extractUnit,
} from '@/lib/ai-extraction/valueParser';
import { isSuggestionPending } from '@/lib/ai-extraction/suggestionUtils';

// =================== INTERFACES ===================

interface FieldInputProps {
  field: ExtractionField;
  instanceId: string;
  value: any;
  onChange: (value: any) => void;
  projectId: string;
  articleId: string;
  otherExtractions?: OtherExtraction[];
  aiSuggestion?: AISuggestion;
  onAcceptAI?: () => void;
  onRejectAI?: () => void;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  disabled?: boolean;
  viewMode?: 'extract' | 'compare';
}

// =================== COMPONENT ===================

export function FieldInput(props: FieldInputProps) {
  const { field, instanceId, value, onChange, disabled, otherExtractions, aiSuggestion, onAcceptAI, onRejectAI, getSuggestionsHistory, isActionLoading, viewMode } = props;
  const [validationError, setValidationError] = useState<string | null>(null);
  
  // Espaçamento fixo confortável
  const containerPadding = 'py-6';
  const inputHeight = 'h-11';
  const gap = 'gap-6';

  // Lógica de valor exibido no campo:
  // - Valor do estado local sempre tem prioridade (pode ser manual ou aceito da IA)
  // - Se há sugestão aceita e não há valor manual, mostrar valor da sugestão
  const hasAIPending = aiSuggestion ? isSuggestionPending(aiSuggestion) : false;
  const hasAIAccepted = aiSuggestion ? aiSuggestion.status === 'accepted' : false;
  
  // Função helper para normalizar valores para comparação
  const normalizeValueForComparison = (val: any): any => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'value' in val) {
      return { value: val.value, unit: val.unit || null };
    }
    return val;
  };
  
  // Distinguir valor manual de valor aceito da IA:
  // - Se há sugestão aceita e o valor atual é igual ao valor da sugestão, NÃO é manual
  // - Se o valor atual é diferente do valor da sugestão aceita, é manual (usuário editou)
  // - Se não há sugestão aceita, qualquer valor não vazio é considerado manual
  const aiAcceptedValue = hasAIAccepted && aiSuggestion?.value !== null && aiSuggestion?.value !== undefined 
    ? aiSuggestion.value 
    : null;
  
  // Comparação mais robusta de valores (considera objetos e arrays)
  const isValueEqualToAccepted = aiAcceptedValue !== null && 
    JSON.stringify(normalizeValueForComparison(value)) === JSON.stringify(normalizeValueForComparison(aiAcceptedValue));
  
  // Se há valor no campo mas não é igual ao aceito, é manual
  // Se não há sugestão aceita, valor no campo é considerado manual
  const hasManualValue = !isEmptyValue(value) && (!hasAIAccepted || !isValueEqualToAccepted);
  
  // Valor a exibir: priorizar valor do estado (que já foi atualizado após aceitar)
  // Se não há valor no estado mas há sugestão aceita, mostrar valor da sugestão
  const displayValue = !isEmptyValue(value)
    ? value
    : (hasAIAccepted && aiAcceptedValue !== null)
      ? aiAcceptedValue
      : '';

  // Validação básica
  const validateValue = (val: any): boolean => {
    // Para campos obrigatórios, verificar se o valor não está vazio
    if (field.is_required) {
      if (isEmptyValue(val)) {
        setValidationError('Campo obrigatório');
        return false;
      }
    }

    if (field.field_type === 'number') {
      // Se tem valor mas não é um número válido
      if (!isEmptyValue(val) && !isValidNumber(val)) {
        setValidationError('Valor deve ser um número');
        return false;
      }
    }

    setValidationError(null);
    return true;
  };

  const handleChange = (newValue: any) => {
    validateValue(newValue);
    onChange(newValue);
  };

  // Renderizar input baseado no tipo
  const renderInput = () => {
    switch (field.field_type) {
      case 'text':
        // Se description longa, usar textarea
        const labelLower = field.label.toLowerCase();
        const isLongText = labelLower.includes('descrição') ||
                          labelLower.includes('justificativa') ||
                          labelLower.includes('comentário') ||
                          labelLower.includes('conclusão') ||
                          labelLower.includes('conclusões') ||
                          labelLower.includes('resultado') ||
                          labelLower.includes('resultados') ||
                          labelLower.includes('análise') ||
                          labelLower.includes('análises') ||
                          labelLower.includes('discussão') ||
                          labelLower.includes('observação') ||
                          labelLower.includes('observações');
        
        if (isLongText) {
          return (
            <Textarea
              value={displayValue || ''}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={`Digite ${field.label.toLowerCase()}`}
              disabled={disabled}
              className={cn(
                "text-base min-h-[100px]",
                hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10",
                validationError && "border-destructive"
              )}
            />
          );
        }

        return (
          <Input
            value={displayValue || ''}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={`Digite ${field.label.toLowerCase()}`}
            disabled={disabled}
              className={cn(
                inputHeight,
                "text-base",
                hasAIPending && "border-purple-500 bg-purple-50/30 dark:bg-purple-950/10",
                validationError && "border-destructive"
              )}
          />
        );

      case 'number':
        // Parse valor (pode ser objeto {value, unit} ou valor simples)
        const numValue = extractValue(displayValue);
        const currentUnit = extractUnit(displayValue) 
          ?? (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit);
        
        // Priorizar allowed_units customizadas sobre dicionário automático
        const relatedUnits = field.allowed_units && field.allowed_units.length > 0
          ? field.allowed_units // Usar unidades configuradas pelo manager (primeira é padrão)
          : (field.unit ? getRelatedUnits(field.unit) : []); // Fallback para dicionário automático
        
        const hasMultipleUnits = relatedUnits.length > 0;

        return (
          <div className="flex gap-2">
            <Input
              type="number"
              value={numValue || ''}
              onChange={(e) => {
                if (hasMultipleUnits) {
                  handleChange({ value: e.target.value, unit: currentUnit || field.unit });
                } else {
                  handleChange(e.target.value);
                }
              }}
              placeholder="0"
              disabled={disabled}
              className={cn("flex-1", inputHeight, "text-base", validationError && "border-destructive")}
            />
            
            {/* Unit selector se houver unidades */}
            {hasMultipleUnits ? (
              <Select
                value={currentUnit || ''}
                onValueChange={(newUnit) => {
                  handleChange({ value: numValue, unit: newUnit });
                }}
                disabled={disabled}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Todas as unidades disponíveis (allowed_units ou relacionadas) */}
                  {relatedUnits.map((unit, index) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                      {index === 0 && field.allowed_units && field.allowed_units.length > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">(padrão)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit) ? (
              // Badge fixo se não houver múltiplas unidades mas houver uma unidade definida
              <Badge variant="outline" className="shrink-0 self-center">
                {field.allowed_units && field.allowed_units.length > 0 ? field.allowed_units[0] : field.unit}
              </Badge>
            ) : null}
          </div>
        );

      case 'date':
        return (
          <Input
            type="date"
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className={cn(inputHeight, "text-base", validationError && "border-destructive")}
          />
        );

      case 'select':
        const options = field.allowed_values as any[] || [];
        if (field.allow_other) {
          return (
            <SelectWithOther
              options={options}
              value={value || null}
              onChange={handleChange}
              allowOther={true}
              otherLabel={field.other_label || 'Outro (especificar)'}
              otherPlaceholder={field.other_placeholder || undefined}
              disabled={disabled}
              placeholder={`Selecione ${field.label.toLowerCase()}`}
              className={cn(validationError && 'border-destructive')}
            />
          );
        }
        return (
          <Select 
            value={value || ''} 
            onValueChange={handleChange} 
            disabled={disabled}
          >
            <SelectTrigger className={cn(inputHeight, "text-base", validationError && "border-destructive")}>
              <SelectValue placeholder={`Selecione ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option: any, index: number) => {
                const optionValue = typeof option === 'string' ? option : option.value;
                const optionLabel = typeof option === 'string' ? option : option.label || option.value;
                return (
                  <SelectItem key={index} value={optionValue}>
                    {optionLabel}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );

      case 'multiselect':
        const mOptions = field.allowed_values as any[] || [];
        if (field.allow_other) {
          return (
            <MultiSelectWithOther
              options={mOptions}
              value={value || null}
              onChange={handleChange}
              allowOther={true}
              otherLabel={field.other_label || 'Outro (especificar)'}
              otherPlaceholder={field.other_placeholder || undefined}
              disabled={disabled}
              placeholder={`Selecione ${field.label.toLowerCase()}`}
            />
          );
        }
        // fallback simples
        return (
          <Input
            value={Array.isArray(value) ? value.join(', ') : value || ''}
            onChange={(e) => handleChange(e.target.value.split(',').map(v => v.trim()))}
            placeholder="Valores separados por vírgula"
            disabled={disabled}
            className={cn(inputHeight, "text-base", validationError && "border-destructive")}
          />
        );

      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={value || false}
              onCheckedChange={handleChange}
              disabled={disabled}
            />
            <span className="text-sm text-muted-foreground">
              {value ? 'Sim' : 'Não'}
            </span>
          </div>
        );

      default:
        return (
          <Input
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={disabled}
            className={cn(inputHeight, "text-base", validationError && "border-destructive")}
          />
        );
    }
  };

  // Determinar se deve mostrar display de sugestão abaixo do input
  // Mostrar se:
  // - Sugestão existe (pending, accepted ou rejected) E
  // - Para sugestões PENDING: mostrar sempre (mesmo se campo tem valor)
  // - Para sugestões ACCEPTED: mostrar se o valor atual é igual ao aceito (não foi editado manualmente)
  // - Para sugestões REJECTED: mostrar para permitir reverter
  const shouldShowSuggestion = aiSuggestion && (
    // Sempre mostrar sugestões pendentes
    aiSuggestion.status === 'pending' ||
    // Mostrar aceitas se o valor ainda é igual (não foi editado manualmente)
    (aiSuggestion.status === 'accepted' && !hasManualValue) ||
    // Mostrar rejeitadas para permitir reverter
    aiSuggestion.status === 'rejected'
  );

  return (
    <div className={cn("grid grid-cols-[30%_1fr] items-start", gap, containerPadding)}>
      {/* Coluna esquerda: Label + Description */}
      <div className="space-y-1 pt-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          {field.label}
          {field.is_required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {field.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {field.description}
          </p>
        )}
      </div>
      
      {/* Coluna direita: Input */}
              <div className="space-y-2 min-w-0">
        {/* Badges de colaboração - apenas no modo comparação */}
        {viewMode === 'compare' && otherExtractions && otherExtractions.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <OtherExtractionsPopover
              fieldId={field.id}
              instanceId={instanceId}
              extractions={otherExtractions}
              myValue={value}
            >
              <OtherExtractionsButton count={otherExtractions.length} />
            </OtherExtractionsPopover>
          </div>
        )}

        {/* Input com badge + histórico ao lado direito */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            {renderInput()}
          </div>
          
          <div className="flex items-center gap-1 shrink-0">
            {/* Badge + Info sempre visíveis ao lado direito do input (se houver sugestão pendente ou aceita) */}
          {aiSuggestion && 
           (aiSuggestion.status === 'pending' || aiSuggestion.status === 'accepted') && (
            <AISuggestionBadge
              suggestion={aiSuggestion}
            />
          )}

            {/* Botão de Histórico - sempre visível se houver função getHistory */}
            {getSuggestionsHistory && aiSuggestion && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <AISuggestionHistoryPopover
                      instanceId={instanceId}
                      fieldId={field.id}
                      currentSuggestionId={aiSuggestion.id}
                      getHistory={getSuggestionsHistory}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn(
                            "h-7 w-7",
                            "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                          title="Histórico de sugestões"
                        >
                          <History className="h-4 w-4" />
                        </Button>
                      }
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Histórico de sugestões</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Valor sugerido + botões aceitar/rejeitar abaixo do input - apenas se não há valor manual (Opção F) */}
        {shouldShowSuggestion && (
          <AISuggestionDisplay
            suggestion={aiSuggestion}
            instanceId={instanceId}
            fieldId={field.id}
            onAccept={onAcceptAI}
            onReject={onRejectAI}
            loading={isActionLoading ? isActionLoading(instanceId, field.id) === 'accept' || isActionLoading(instanceId, field.id) === 'reject' : false}
            getHistory={getSuggestionsHistory}
          />
        )}

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {validationError}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Exporta versão memoizada para evitar re-renders desnecessários
 * 
 * Performance crítica: Só re-renderiza se valor DESTE campo específico mudou
 * Soluciona bug de input perdendo foco a cada caractere
 */
export default memo(FieldInput, (prevProps, nextProps) => {
  // Comparação otimizada: apenas props que afetam ESTE campo
  const aiSuggestionChanged = prevProps.aiSuggestion?.id !== nextProps.aiSuggestion?.id ||
                                prevProps.aiSuggestion?.status !== nextProps.aiSuggestion?.status;
  
  return (
    prevProps.field.id === nextProps.field.id &&
    prevProps.instanceId === nextProps.instanceId &&
    prevProps.value === nextProps.value &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.viewMode === nextProps.viewMode &&
    !aiSuggestionChanged // Re-renderizar se sugestão mudar (status ou ID)
  );
});

