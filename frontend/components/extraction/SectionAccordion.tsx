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
import {ChevronDown, Plus} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {useRef} from 'react';
import MemoizedFieldInput from './FieldInput'; // Use memoized version
import {InstanceCard} from './InstanceCard';
import {SectionAIExtractButton} from '@/components/extraction/ai/shared/SectionAIExtractButton';
import type {ExtractionEntityType, ExtractionField, ExtractionInstance} from '@/types/extraction';
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
    /**
     * Active HITL-session run id. When set, AI extraction appends
     * proposals to that run instead of creating a fresh one — keeps
     * multiple section extractions accumulating on the same run.
     */
    runId?: string | null;
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void>;
  selectSuggestion?: (instanceId: string, fieldId: string, proposalRecordId: string, value: unknown) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  onAddInstance?: () => void;
  onRemoveInstance?: (instanceId: string) => void;
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

  // Calcular porcentagem de progresso
  const progressPercentage = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

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
      className="border-b border-border/40 last:border-b-0"
    >
      <AccordionItem value={entityType.id} className="border-none group/accordion-item">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm px-3 py-2 hover:bg-muted/40 transition-colors duration-75">
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
                  <h3 className="font-medium text-[14px]">{entityType.label}</h3>
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
              {/* Per-section AI extract — shared component, sibling of the
                  trigger to avoid nested buttons. */}
            <SectionAIExtractButton
              projectId={projectId}
              articleId={articleId}
              templateId={templateId}
              entityTypeId={entityType.id}
              entityLabel={entityType.label}
              runId={props.runId}
              parentInstanceId={props.parentInstanceId}
              disabled={instances.length === 0 && !isMultiple}
              onExtractionComplete={props.onExtractionComplete}
            />
              {/* Chevron manually positioned at the end, after AI button - clickable to open/close accordion */}
            <button
              type="button"
              onClick={handleChevronClick}
              className="flex items-center justify-center h-8 w-8 shrink-0 hover:bg-muted rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Toggle accordion"
            >
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/accordion-item:rotate-180" />
            </button>
          </div>
        </div>

        <AccordionContent className="px-3 pb-4">
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
                      aiSuggestions={props.aiSuggestions}
                      onAcceptAI={props.onAcceptAI}
                      onRejectAI={props.onRejectAI}
                      selectSuggestion={props.selectSuggestion}
                      getSuggestionsHistory={props.getSuggestionsHistory}
                      isActionLoading={props.isActionLoading}
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
              <div className="divide-y divide-border/40">
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
                      aiSuggestion={props.aiSuggestions?.[key]}
                      onAcceptAI={() => props.onAcceptAI?.(instances[0].id, field.id)}
                      onRejectAI={() => props.onRejectAI?.(instances[0].id, field.id)}
                      selectSuggestion={props.selectSuggestion}
                      getSuggestionsHistory={props.getSuggestionsHistory}
                      isActionLoading={props.isActionLoading}
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

