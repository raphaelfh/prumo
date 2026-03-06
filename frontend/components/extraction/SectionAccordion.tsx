/**
 * Extraction section accordion
 *
 * Renders a section (entity type) with its fields.
 * Supports cardinality 'one' (single instance) and 'many' (multiple instances).
 * 
 * @component
 */

import {Accordion, AccordionContent, AccordionItem,} from '@/components/ui/accordion';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {ChevronDown, Loader2, Plus, Sparkles} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {useRef} from 'react';
import MemoizedFieldInput from './FieldInput'; // Use memoized version
import {InstanceCard} from './InstanceCard';
import {useSectionExtraction} from '@/hooks/extraction/useSectionExtraction';
import type {ExtractionEntityType, ExtractionField, ExtractionInstance} from '@/types/extraction';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';

// =================== INTERFACES ===================

interface SectionAccordionProps {
  entityType: ExtractionEntityType;
  instances: ExtractionInstance[];
  fields: ExtractionField[];
  values: Record<string, any>;
  onValueChange: (instanceId: string, fieldId: string, value: any) => void;
  projectId: string;
  articleId: string;
    templateId: string; // Required for section extraction
    parentInstanceId?: string; // Parent instance ID (to filter child entities by model)
  otherExtractions?: OtherExtraction[];
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  onAddInstance?: () => void;
  onRemoveInstance?: (instanceId: string) => void;
  viewMode?: 'extract' | 'compare';
    onExtractionComplete?: (runId?: string) => void | Promise<void>; // Callback to refresh suggestions after extraction
}

// =================== COMPONENT ===================

export function SectionAccordion(props: SectionAccordionProps) {
  const {
    entityType,
    instances,
    fields,
    values,
    onValueChange,
    projectId,
    articleId,
    templateId
  } = props;

  const isMultiple = entityType.cardinality === 'many';

    // Hook for specific section extraction
    // onSuccess callback notifies parent for suggestion refresh
    // IMPORTANT: onSuccess must not block - call without await so loading is not stuck
  const { extractSection, loading: extractionLoading } = useSectionExtraction({
    onSuccess: async (runId, suggestionsCreated) => {
        // Notify parent that extraction completed
        // CRITICAL: Do not await here - let it run in background
      // O loading deve ser resetado pelo hook independentemente deste callback
      if (props.onExtractionComplete) {
        try {
          const result = props.onExtractionComplete(runId);
          // Se retornar Promise, tratar erro sem bloquear
          if (result && typeof result === 'object' && 'catch' in result) {
            result.catch(err => {
              console.error('Erro no callback onExtractionComplete:', err);
                // Do not block the hook from resetting loading
            });
          }
        } catch (err) {
          console.error('Erro ao chamar callback onExtractionComplete:', err);
            // Do not block the hook from resetting loading
        }
      }
    },
  });

  /**
   * Handler for section extraction
   * IMPORTANT: For cardinality="many", the backend now creates instances automatically,
   * so we allow extraction even without pre-existing instances.
   */
  const handleExtractSection = async () => {
      // Check for existing instances
      // EXCEPTION: For cardinality="many", allow extraction (backend creates instances automatically)
    if (instances.length === 0 && !isMultiple) {
        // Toast will be shown by the hook; we can add here too if needed
      return;
    }

    try {
      await extractSection({
        projectId,
        articleId,
        templateId,
        entityTypeId: entityType.id,
        parentInstanceId: props.parentInstanceId, // Nova: passar parentInstanceId quando fornecido
      });
    } catch (error) {
        // Error already handled by hook with toast
      console.error('Section extraction failed:', error);
    }
  };

    // Calculate progress for this section
  const requiredFields = fields.filter(f => f.is_required);
  const totalRequired = requiredFields.length * (isMultiple ? instances.length : 1);
  
  const completedRequired = requiredFields.reduce((count, field) => {
    if (isMultiple) {
        // For multiple sections, count per instance
      return count + instances.filter(instance => {
        const key = `${instance.id}_${field.id}`;
        const value = values[key];
        return value !== null && value !== undefined && value !== '';
      }).length;
    } else {
        // For single section
      const instance = instances[0];
      if (!instance) return count;
      const key = `${instance.id}_${field.id}`;
      const value = values[key];
      return count + (value !== null && value !== undefined && value !== '' ? 1 : 0);
    }
  }, 0);

  const isComplete = totalRequired > 0 && completedRequired === totalRequired;

  // Calcular porcentagem de progresso
  const progressPercentage = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

  // Determinar cor da borda esquerda baseada no status
  const borderColor = isComplete 
    ? "border-l-green-500" 
    : completedRequired > 0
    ? "border-l-blue-500"
    : "border-l-slate-300";

    // Ref for accordion trigger so chevron can be clicked to open/close
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Disparar o clique no trigger do accordion
    triggerRef.current?.click();
  };

  return (
    <Accordion 
      type="single"
      collapsible
      defaultValue={entityType.id}
      className={cn("bg-white border-l-4", borderColor)}
    >
      <AccordionItem value={entityType.id} className="border-none group/accordion-item">
        <div className="px-6 py-4 hover:bg-slate-50/50">
          <div className="flex items-center gap-3">
            <AccordionPrimitive.Header className="flex flex-1">
              <AccordionPrimitive.Trigger
                ref={triggerRef}
                className={cn(
                  "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:no-underline"
                )}
              >
                  {/* Title on the left */}
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-base">{entityType.label}</h3>
                  {isMultiple && (
                    <Badge variant="outline" className="text-xs">
                        Multiple ({instances.length})
                    </Badge>
                  )}
                </div>
                  {/* Progress on the right */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-medium">{completedRequired}/{totalRequired}</span>
                  <span>{progressPercentage}%</span>
                </div>
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
              {/* Minimal AI extraction button - outside AccordionTrigger to avoid nested buttons */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevenir toggle do accordion
                      handleExtractSection();
                    }}
                    disabled={extractionLoading || (instances.length === 0 && !isMultiple)}
                    title={
                      instances.length === 0 && !isMultiple
                          ? t('extraction', 'createInstanceBeforeExtract')
                          : t('extraction', 'extractSectionWithAI').replace('{{label}}', entityType.label)
                    }
                  >
                    {extractionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-primary" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {instances.length === 0 && !isMultiple
                        ? t('extraction', 'createInstanceBeforeExtract')
                      : extractionLoading
                            ? t('extraction', 'extractingWithAI')
                            : t('extraction', 'extractSectionWithAI').replace('{{label}}', entityType.label)}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
              {/* Chevron manually positioned at the end, after AI button - clickable to open/close accordion */}
            <button
              type="button"
              onClick={handleChevronClick}
              className="flex items-center justify-center h-8 w-8 shrink-0 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              aria-label="Toggle accordion"
            >
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/accordion-item:rotate-180" />
            </button>
          </div>
        </div>

        <AccordionContent className="px-8 pb-8">
          <div className="space-y-6">
            {instances.length === 0 ? (
              <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">{t('extraction', 'sectionNoInstances')}</p>
                {isMultiple && props.onAddInstance && (
                  <Button
                    variant="outline"
                    onClick={props.onAddInstance}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                      {t('extraction', 'sectionAddInstance')} {entityType.label}
                  </Button>
                )}
              </div>
            ) : isMultiple ? (
                // Multiple section: show instance cards
              <>
                {instances.map((instance, index) => (
                  <div key={instance.id}>
                    <InstanceCard
                      instance={instance}
                      index={index + 1}
                      fields={fields}
                      values={values}
                      onValueChange={(fieldId, value) =>
                        onValueChange(instance.id, fieldId, value)
                      }
                      onRemove={() => props.onRemoveInstance?.(instance.id)}
                      canRemove={true}
                      projectId={projectId}
                      articleId={articleId}
                      otherExtractions={props.otherExtractions}
                      aiSuggestions={props.aiSuggestions}
                      onAcceptAI={props.onAcceptAI}
                      onRejectAI={props.onRejectAI}
                      getSuggestionsHistory={props.getSuggestionsHistory}
                      isActionLoading={props.isActionLoading}
                      viewMode={props.viewMode}
                    />
                  </div>
                ))}

                {props.onAddInstance && (
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={props.onAddInstance}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                        {t('extraction', 'addInstanceLabel').replace('{{label}}', entityType.label)}
                    </Button>
                  </div>
                )}
              </>
            ) : (
                // Single section: show fields directly
              <div className="divide-y divide-slate-100">
                {fields.map(field => {
                  const key = `${instances[0].id}_${field.id}`;
                  
                  return (
                    <MemoizedFieldInput
                      key={field.id}
                      field={field}
                      instanceId={instances[0].id}
                      value={values[key]}
                      onChange={(value) =>
                        onValueChange(instances[0].id, field.id, value)
                      }
                      projectId={projectId}
                      articleId={articleId}
                      otherExtractions={props.otherExtractions}
                      aiSuggestion={props.aiSuggestions?.[key]}
                      onAcceptAI={() => props.onAcceptAI?.(instances[0].id, field.id)}
                      onRejectAI={() => props.onRejectAI?.(instances[0].id, field.id)}
                      getSuggestionsHistory={props.getSuggestionsHistory}
                      isActionLoading={props.isActionLoading}
                      viewMode={props.viewMode}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

