/**
 * Card de Instância de Extração
 * 
 * Componente usado para seções com cardinality='many'.
 * Cada card representa uma instância (ex: "Model 1", "Model 2").
 * 
 * Features:
 * - Label editável inline
 * - Campos da instância
 * - Botão remover
 * - Badge com número
 * 
 * @component
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Edit2, Trash2, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { FieldInput } from './FieldInput';
import type { ExtractionField, ExtractionInstance } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

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
  onAcceptAI?: (fieldId: string) => Promise<void>;
  onRejectAI?: (fieldId: string) => Promise<void>;
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

      instance.label = editedLabel.trim(); // Atualizar local
      setIsEditingLabel(false);
      toast.success('Label atualizado com sucesso');

    } catch (error: any) {
      console.error('Erro ao atualizar label:', error);
      toast.error('Erro ao atualizar label');
      setEditedLabel(instance.label); // Reverter
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedLabel(instance.label);
    setIsEditingLabel(false);
  };

  return (
    <div className="bg-slate-50 rounded-lg border border-slate-200">
      {/* Header da instância */}
      <div className="px-6 py-4 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            {/* Badge com número */}
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

          {/* Botão remover */}
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

      {/* Campos da instância */}
      <div className="bg-white rounded-b-lg">
        {fields.map(field => {
          const key = `${instance.id}_${field.id}`;
          
          return (
            <FieldInput
              key={field.id}
              field={field}
              instanceId={instance.id}
              value={values[key]}
              onChange={(value) => props.onValueChange(field.id, value)}
              projectId={projectId}
              articleId={articleId}
              otherExtractions={props.otherExtractions}
              aiSuggestion={props.aiSuggestions?.[key]}
              onAcceptAI={() => props.onAcceptAI?.(field.id)}
              onRejectAI={() => props.onRejectAI?.(field.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

