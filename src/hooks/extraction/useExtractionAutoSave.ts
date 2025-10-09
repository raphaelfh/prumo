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
      const upserts = valuesToSave.map(([key, value]) => {
        const [instanceId, fieldId] = key.split('_');

        return {
          project_id: projectId,
          article_id: articleId,
          instance_id: instanceId,
          field_id: fieldId,
          value: { value }, // Wrap em objeto conforme schema do banco
          source: 'human' as const,
          reviewer_id: user.id,
          is_consensus: false
        };
      });

      console.log(`💾 Auto-saving ${upserts.length} valores...`);

      // Batch upsert (atualiza se existe, insere se não)
      const { error: upsertError } = await supabase
        .from('extracted_values')
        .upsert(upserts, {
          onConflict: 'instance_id,field_id,reviewer_id'
        });

      if (upsertError) throw upsertError;

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

