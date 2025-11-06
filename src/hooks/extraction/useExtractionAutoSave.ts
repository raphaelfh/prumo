/**
 * Hook para auto-save de valores extraídos
 * 
 * Features:
 * - Debounce de 3 segundos após última mudança
 * - Batch upsert para performance
 * - Tracking de último save
 * - Error handling
 * 
 * @hook
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// =================== INTERFACES ===================

interface UseExtractionAutoSaveProps {
  articleId: string;
  projectId: string;
  values: Record<string, any>; // { instanceId_fieldId: value }
  enabled?: boolean;
}

export interface UseExtractionAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  error: string | null;
  saveNow: () => Promise<void>;
}

// =================== HOOK ===================

export function useExtractionAutoSave(
  props: UseExtractionAutoSaveProps
): UseExtractionAutoSaveReturn {
  const { articleId, projectId, values, enabled = true } = props;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const previousValuesRef = useRef<string>('');

  // Auto-save com debounce de 3 segundos
  useEffect(() => {
    if (!enabled || !articleId || !projectId) return;

    // Converter valores para string para comparar mudanças
    const currentValuesStr = JSON.stringify(values);

    // Se não mudou, não fazer nada
    if (currentValuesStr === previousValuesRef.current) {
      return;
    }

    previousValuesRef.current = currentValuesStr;

    // Cancelar save anterior agendado
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Agendar novo save após 3 segundos
    saveTimeoutRef.current = setTimeout(() => {
      saveValues();
    }, 3000);

    // Cleanup
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [values, enabled, articleId, projectId]);

  const saveValues = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      // Filtrar apenas valores não vazios
      const valuesToSave = Object.entries(values).filter(([, value]) => {
        return value !== null && value !== undefined && value !== '';
      });

      if (valuesToSave.length === 0) {
        console.log('⚠️ Nenhum valor para salvar (todos vazios)');
        setIsSaving(false);
        return;
      }

      // Preparar batch de upserts
      const upserts = valuesToSave.map(([key, valueData]) => {
        const [instanceId, fieldId] = key.split('_');

        // Extrair value e unit (se valueData é objeto com unit)
        const actualValue = typeof valueData === 'object' && 'value' in valueData
          ? valueData.value
          : valueData;
        
        const unitValue = typeof valueData === 'object' && 'unit' in valueData
          ? valueData.unit
          : null;

        return {
          project_id: projectId,
          article_id: articleId,
          instance_id: instanceId,
          field_id: fieldId,
          value: { value: actualValue }, // Wrap em objeto conforme schema do banco
          unit: unitValue, // ✅ Salvar unit se fornecido
          source: 'human' as const,
          reviewer_id: user.id,
          is_consensus: false
        };
      });

      console.log(`💾 Auto-saving ${upserts.length} valores...`);

      // Verificar quais valores já existem (batch SELECT)
      const { data: existingValues, error: selectError } = await supabase
        .from('extracted_values' as any)
        .select('id, instance_id, field_id, reviewer_id')
        .eq('article_id', articleId)
        .eq('reviewer_id', user.id)
        .in('instance_id', [...new Set(upserts.map(u => u.instance_id))]);

      if (selectError) throw selectError;

      // Criar mapa de IDs existentes: key => id
      const existingMap = new Map<string, string>();
      (existingValues || []).forEach((ev: any) => {
        const key = `${ev.instance_id}_${ev.field_id}_${ev.reviewer_id}`;
        existingMap.set(key, ev.id);
      });

      // Separar em UPDATEs e INSERTs
      const toUpdate: Array<{ id: string; data: any }> = [];
      const toInsert: any[] = [];

      upserts.forEach(upsert => {
        const key = `${upsert.instance_id}_${upsert.field_id}_${upsert.reviewer_id}`;
        const existingId = existingMap.get(key);
        
        if (existingId) {
          toUpdate.push({ id: existingId, data: upsert });
        } else {
          toInsert.push(upsert);
        }
      });

      // Executar UPDATEs em lote (se houver)
      if (toUpdate.length > 0) {
        const updatePromises = toUpdate.map(({ id, data }) =>
          supabase
            .from('extracted_values' as any)
            .update(data)
            .eq('id', id)
        );
        const updateResults = await Promise.all(updatePromises);
        const updateErrors = updateResults.filter(r => r.error).map(r => r.error);
        if (updateErrors.length > 0) {
          throw new Error(`Erro ao atualizar ${updateErrors.length} valores: ${updateErrors[0]?.message}`);
        }
      }

      // Executar INSERTs em lote (se houver)
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('extracted_values' as any)
          .insert(toInsert);
        if (insertError) throw insertError;
      }

      setLastSaved(new Date());
      console.log(`✅ Auto-save concluído: ${upserts.length} valores salvos`);

    } catch (err: any) {
      console.error('❌ Erro no auto-save:', err);
      setError(err.message || 'Erro ao salvar');
      toast.error('Erro ao salvar dados automaticamente');
    } finally {
      setIsSaving(false);
    }
  };

  const saveNow = async () => {
    // Cancelar save agendado
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Salvar imediatamente
    await saveValues();
  };

  return {
    isSaving,
    lastSaved,
    error,
    saveNow
  };
}

