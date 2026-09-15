/**
 * Extraction section accordion
 *
 * Renders a section (entity type) with its fields.
 * Supports cardinality 'one' (single instance) and 'many' (multiple instances).
 * 
 * @component
 */

import {Accordion, AccordionContent, AccordionItem,} from '@/components/ui/accordion';
import {isValueEmpty} from '@/lib/extraction/valueSemantics';
import {useSectionOpen} from '@/components/runs/SectionOpenContext';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import {Tooltip, TooltipTrigger, TooltipContent} from '@/components/ui/tooltip';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {ChevronDown, Plus} from 'lucide-react';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {useRef} from 'react';
import {ExtractionReviewTable, type ReviewWorkspace} from './review/ExtractionReviewTable';
import MemoizedFieldInput from './FieldInput'; // Use memoized version
import {InstanceCard} from './InstanceCard';
import type {EntryIdentityChanges} from './AddEntryDialog';
import {DEFAULT_ENTRY_NOUN, entryKeyOf, keyFieldOf} from '@/lib/extraction/entryKey';
import {useRunEditability} from '@/components/runs/RunEditabilityContext';
import {SectionAIExtractButton} from '@/components/extraction/ai/shared/SectionAIExtractButton';
import type {ExtractionEntityType, ExtractionField, ExtractionInstance} from '@/types/extraction';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';

// =================== INTERFACES ===================

interface SectionAccordionProps {
  presentation?: 'review-table' | 'default';
  review?: ReviewWorkspace;
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
  selectSuggestion?: (instanceId: string, fieldId: string, proposalRecordId: string, value: unknown, confidence: number) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  onAddInstance?: () => void;
  onRemoveInstance?: (instanceId: string) => void;
  /** Rename / re-key one entry; absent → no rename affordance on the cards. */
  onRenameInstance?: (instanceId: string, changes: EntryIdentityChanges) => Promise<void>;
  /**
   * Badge count override for containers that render only the active
   * instance but represent more entries (the model container passes the
   * total model count).
   */
  totalInstanceCount?: number;
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

  const compact = props.presentation === 'review-table' && !!props.review;
  const isMultiple = entityType.cardinality === 'many';
  // Read-only run: instance add/remove affordances hide (published view).
  const { readOnly } = useRunEditability();
  const [open, setOpen] = useSectionOpen(entityType.id, true);
  // The field identifying one entry (0059) labels the rename dialog's key
  // input; the entry noun (B-8) names the entry in its copy.
  const keyField = keyFieldOf(fields);
  const entryLabel = entityType.entry_label ?? DEFAULT_ENTRY_NOUN;

    // Calculate progress for this section
  const requiredFields = fields.filter(f => f.is_required);
  const totalRequired = requiredFields.length * (isMultiple ? instances.length : 1);
  
  // Emptiness by the shared predicate the field rows and the section rail count
  // with, so a resolved "no information" marker reads as answered here too.
  const completedRequired = requiredFields.reduce((count, field) => {
    if (isMultiple) {
        // For multiple sections, count per instance
      return count + instances.filter(instance => !isValueEmpty(values[`${instance.id}_${field.id}`])).length;
    } else {
        // For single section
      const instance = instances[0];
      if (!instance) return count;
      return count + (isValueEmpty(values[`${instance.id}_${field.id}`]) ? 0 : 1);
    }
  }, 0);

  const progressPercentage = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

    // Ref for accordion trigger so chevron can be clicked to open/close
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerRef.current?.click();
  };

  return (
    <Accordion 
      type="single"
      collapsible
      value={open ? entityType.id : ''}
      onValueChange={(value) => setOpen(value === entityType.id)}
      className={cn("border-b border-border/40 last:border-b-0", compact && props.review?.navigation.focused && props.review.navigation.current?.sectionId !== entityType.id && "hidden")}
    >
      <AccordionItem value={entityType.id} className="border-none group/accordion-item">
        <div className={cn("sticky z-10 hover:bg-muted/40 transition-colors duration-75", compact ? "top-10 bg-background px-2 py-0" : "top-0 bg-background/80 backdrop-blur-sm px-3 py-2")}>
          <div className="flex items-center gap-3">
            <AccordionPrimitive.Header className="flex min-w-0 flex-1">
              <Tooltip><TooltipTrigger asChild>
              <AccordionPrimitive.Trigger
                ref={triggerRef}
                className={cn(
                  "flex flex-1 items-center justify-between font-medium transition-all hover:no-underline", compact ? "py-1.5" : "py-4"
                )}
              >
                  {/* Title on the left */}
                <div className="flex items-center gap-3">
                  {compact && <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", !open && "-rotate-90")} strokeWidth={1.5}/>}
                  <span className={cn("font-medium", compact ? "text-[13px]" : "text-[14px]")}>{entityType.label}</span>
                  {isMultiple && (
                    <Badge variant="outline" className="text-xs">
                        {t('extraction', 'sectionMultipleBadge').replace(
                            '{{count}}',
                            String(props.totalInstanceCount ?? instances.length),
                        )}
                    </Badge>
                  )}
                </div>
                  {/* Progress on the right */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-medium">{completedRequired}/{totalRequired}</span>
                  {!compact && <span>{progressPercentage}%</span>}
                </div>
              </AccordionPrimitive.Trigger>
              </TooltipTrigger>{compact && entityType.description && <TooltipContent className="max-w-sm">{entityType.description}</TooltipContent>}</Tooltip>
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
            {!compact && <button
              type="button"
              onClick={handleChevronClick}
              className="flex items-center justify-center h-8 w-8 shrink-0 hover:bg-muted rounded-md transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={entityType.label}
            >
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]/accordion-item:rotate-180" />
            </button>}
          </div>
        </div>

        <AccordionContent {...(compact ? {forceMount: true, hidden: !open} : {})} className={compact ? "p-0" : "px-3 pb-4"}>
          <div className="space-y-6">
            {instances.length === 0 ? (
              <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">{t('extraction', 'sectionNoInstances')}</p>
                {isMultiple && !readOnly && props.onAddInstance && (
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
                      presentation={props.presentation}
                      review={props.review}
                      instance={instance}
                      index={index + 1}
                      fields={fields}
                      values={values}
                      onValueChange={(fieldId, value) =>
                        onValueChange(instance.id, fieldId, value)
                      }
                      onRemove={() => props.onRemoveInstance?.(instance.id)}
                      canRemove={!!props.onRemoveInstance}
                      entryLabel={entryLabel}
                      keyLabel={keyField?.label ?? null}
                      siblingKeys={instances
                        .filter((other) => other.id !== instance.id)
                        .map((other) => entryKeyOf(other) ?? other.label)}
                      onRename={
                        props.onRenameInstance
                          ? (changes) => props.onRenameInstance!(instance.id, changes)
                          : undefined
                      }
                      projectId={projectId}
                      aiSuggestions={props.aiSuggestions}
                      onAcceptAI={props.onAcceptAI}
                      onRejectAI={props.onRejectAI}
                      selectSuggestion={props.selectSuggestion}
                      getSuggestionsHistory={props.getSuggestionsHistory}
                      articleId={articleId}
                    />
                  </div>
                ))}

                {!readOnly && props.onAddInstance && (
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
            ) : compact ? (
              <ExtractionReviewTable instanceId={instances[0].id} fields={fields} values={values} onValueChange={(fieldId, value) => onValueChange(instances[0].id, fieldId, value)} aiSuggestions={props.aiSuggestions} getSuggestionsHistory={props.getSuggestionsHistory} review={props.review}/>
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

