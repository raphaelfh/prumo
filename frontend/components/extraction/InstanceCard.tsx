/**
 * Extraction instance card
 *
 * Used for sections with cardinality='many'.
 * Each card represents one entry (e.g. "Model 1", "Model 2").
 *
 * Features:
 * - Rename / re-key through the entry dialog (identity spec §7: re-keying is
 *   the one identity edit a reviewer makes; the dialog gains the key field)
 * - Instance fields
 * - Remove button
 * - Number badge
 *
 * Hook-free on purpose: the write goes up through `onRename`, like `onRemove`,
 * so the card renders in any test tree without a query client.
 *
 * @component
 */

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Pencil, Trash2} from 'lucide-react';
import {t} from '@/lib/copy';
import {DEFAULT_ENTRY_NOUN, displayEntryKey} from '@/lib/extraction/entryKey';
import {useRunEditability} from '@/components/runs/RunEditabilityContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import MemoizedFieldInput from './FieldInput'; // Use memoized version
import {RenameEntryDialog, type EntryIdentityChanges} from './AddEntryDialog';
import type {ExtractionField, ExtractionInstance} from '@/types/extraction';
import type {AISuggestion, AISuggestionHistoryItem} from '@/hooks/extraction/ai/useAISuggestions';

// =================== INTERFACES ===================

interface InstanceCardProps {
  instance: ExtractionInstance;
  index: number;
  fields: ExtractionField[];
  values: Record<string, any>;
  onValueChange: (fieldId: string, value: any) => void;
  onRemove?: () => void;
  canRemove: boolean;
  projectId: string;
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void>;
  selectSuggestion?: (instanceId: string, fieldId: string, proposalRecordId: string, value: unknown, confidence: number) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  /** Threaded to FieldInput's review popover generation dialog. */
  articleId?: string;
  /** The section's entry noun for the rename dialog copy (B-8 D6). */
  entryLabel?: string;
  /** Label of the section's key field; null on a keyless section. */
  keyLabel?: string | null;
  /** Identities of the OTHER entries at this coordinate (duplicate block). */
  siblingKeys?: string[];
  /** Rename / re-key write; absent → no rename affordance (read-only, QA). */
  onRename?: (changes: EntryIdentityChanges) => Promise<void>;
}

// =================== COMPONENT ===================

export function InstanceCard(props: InstanceCardProps) {
  const {
    instance,
    index,
    fields,
    values,
    onRemove,
    canRemove,
    projectId,
    entryLabel = DEFAULT_ENTRY_NOUN,
    keyLabel = null,
    siblingKeys = [],
    onRename,
  } = props;

  // Read-only run: no remove button, no rename (published view).
  const { readOnly } = useRunEditability();
  const [renaming, setRenaming] = useState(false);

  const removeActionLabel = t('extraction', 'instanceRemoveAction').replace(
    '{{label}}',
    instance.label,
  );
  const renameActionLabel = t('extraction', 'instanceRenameAction').replace(
    '{{label}}',
    instance.label,
  );

  return (
    <div className="bg-muted/30 rounded-lg border border-border/60 shadow-elev-card">
        {/* Instance header */}
      <div className="px-8 py-5 border-b border-border/40">
        {/* One provider for the header's icon-button tooltips (shared
            skip-delay when moving between rename/remove). */}
        <TooltipProvider>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Number badge */}
            <Badge variant="outline" className="text-xs shrink-0 bg-card">
              #{index}
            </Badge>

            <span className="text-sm font-semibold truncate" title={instance.label}>
              {instance.label}
            </span>

            {!readOnly && onRename && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setRenaming(true)}
                    aria-label={renameActionLabel}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{renameActionLabel}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

            {/* Remove button — hidden on read-only runs */}
          {!readOnly && canRemove && onRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRemove}
                  aria-label={removeActionLabel}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{removeActionLabel}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        </TooltipProvider>
      </div>

      {onRename && (
        <RenameEntryDialog
          open={renaming}
          entryLabel={entryLabel}
          keyLabel={keyLabel}
          initialLabel={instance.label}
          initialKey={keyLabel ? displayEntryKey(instance) : null}
          siblingKeys={siblingKeys}
          onConfirm={async (changes) => {
            await onRename(changes);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      )}

        {/* Instance fields */}
      <div className="bg-card rounded-b-lg px-2">
        {fields.map(field => {
          const key = `${instance.id}_${field.id}`;
          const suggestion = props.aiSuggestions?.[key];

            // Debug: log when suggestion is not found but should exist
          if (process.env.NODE_ENV === 'development' && !suggestion) {
              // Check if there are suggestions for other instances of the same field
            const hasSuggestionsForField = Object.keys(props.aiSuggestions || {}).some(
              k => k.endsWith(`_${field.id}`)
            );
            if (hasSuggestionsForField) {
                console.warn(`[InstanceCard] Suggestion not found for ${key}, but there are suggestions for field ${field.id} in other instances`, {
                instanceId: instance.id,
                fieldId: field.id,
                fieldName: field.name,
                fieldLabel: field.label,
                availableKeys: Object.keys(props.aiSuggestions || {}).filter(k => k.endsWith(`_${field.id}`))
              });
            }
          }
          
          return (
            <MemoizedFieldInput
              key={field.id}
              field={field}
              instanceId={instance.id}
              value={values[key]}
              onChange={(value) => props.onValueChange(field.id, value)}
              projectId={projectId}
              aiSuggestion={suggestion}
              onAcceptAI={() => {
                  // Wrapper to pass instanceId with fieldId
                if (props.onAcceptAI) {
                    // onAcceptAI expects (instanceId, fieldId)
                  props.onAcceptAI(instance.id, field.id);
                }
              }}
              onRejectAI={() => {
                  // Wrapper to pass instanceId with fieldId
                if (props.onRejectAI) {
                    // onRejectAI expects (instanceId, fieldId)
                  props.onRejectAI(instance.id, field.id);
                }
              }}
              selectSuggestion={props.selectSuggestion}
              getSuggestionsHistory={props.getSuggestionsHistory}
              articleId={props.articleId}
            />
          );
        })}
      </div>
    </div>
  );
}
