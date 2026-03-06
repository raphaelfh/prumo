/**
 * Extraction instance card
 *
 * Used for sections with cardinality='many'.
 * Each card represents one instance (e.g. "Model 1", "Model 2").
 *
 * Features:
 * - Inline editable label
 * - Instance fields
 * - Remove button
 * - Number badge
 *
 * @component
 */

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Edit2, Save, Trash2, X} from 'lucide-react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {supabase} from '@/integrations/supabase/client';
import MemoizedFieldInput from './FieldInput'; // Use memoized version
import type {ExtractionField, ExtractionInstance} from '@/types/extraction';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';
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
  articleId: string;
  otherExtractions?: OtherExtraction[];
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void>;
  getSuggestionsHistory?: (instanceId: string, fieldId: string) => Promise<AISuggestionHistoryItem[]>;
  isActionLoading?: (instanceId: string, fieldId: string) => 'accept' | 'reject' | null;
  viewMode?: 'extract' | 'compare';
}

// =================== COMPONENT ===================

export function InstanceCard(props: InstanceCardProps) {
  const { instance, index, fields, values, onRemove, canRemove, projectId, articleId } = props;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editedLabel, setEditedLabel] = useState(instance.label);
  const [saving, setSaving] = useState(false);

  const handleSaveLabel = async () => {
    if (editedLabel.trim() === instance.label) {
      setIsEditingLabel(false);
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('extraction_instances')
        .update({ label: editedLabel.trim() })
        .eq('id', instance.id);

      if (error) throw error;

        instance.label = editedLabel.trim(); // Update local
      setIsEditingLabel(false);
        toast.success(t('extraction', 'labelUpdatedSuccess'));

    } catch (error: any) {
        console.error('Error updating label:', error);
        toast.error(t('extraction', 'errors_updateLabel'));
        setEditedLabel(instance.label); // Revert
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedLabel(instance.label);
    setIsEditingLabel(false);
  };

  return (
    <div className="bg-slate-50 rounded-lg border border-slate-200 shadow-sm">
        {/* Instance header */}
      <div className="px-8 py-5 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
              {/* Number badge */}
            <Badge variant="outline" className="text-xs shrink-0 bg-white">
              #{index}
            </Badge>

            {/* Label (editável) */}
            {isEditingLabel ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  value={editedLabel}
                  onChange={(e) => setEditedLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveLabel();
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                  className="h-8 text-sm font-medium"
                  autoFocus
                  disabled={saving}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleSaveLabel}
                  disabled={saving}
                  className="h-7 w-7"
                >
                  <Save className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  className="h-7 w-7"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <h4
                className="text-sm font-semibold cursor-pointer hover:text-primary flex items-center gap-2"
                onClick={() => setIsEditingLabel(true)}
              >
                {instance.label}
                <Edit2 className="h-3 w-3 text-muted-foreground" />
              </h4>
            )}
          </div>

            {/* Remove button */}
          {canRemove && onRemove && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRemove}
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

        {/* Instance fields */}
      <div className="bg-white rounded-b-lg px-2">
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
              articleId={articleId}
              otherExtractions={props.otherExtractions}
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
              getSuggestionsHistory={props.getSuggestionsHistory}
              isActionLoading={props.isActionLoading}
              viewMode={props.viewMode}
            />
          );
        })}
      </div>
    </div>
  );
}

