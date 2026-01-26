/**
 * Hook para auto-save de respostas de assessment
 *
 * Features:
 * - Debounce de 3 segundos após última mudança
 * - Uso do hook useAssessmentResponses para salvar
 * - Tracking de último save
 * - Error handling
 *
 * Baseado em useExtractionAutoSave.ts (DRY + KISS)
 *
 * @hook
 */

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

// =================== INTERFACES ===================

interface UseAssessmentAutoSaveProps {
  responses: Record<string, any>; // { itemId: response }
  save: () => Promise<void>; // Função save do useAssessmentResponses
  enabled?: boolean;
}

export interface UseAssessmentAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  error: string | null;
  saveNow: () => Promise<void>;
}

// =================== HOOK ===================

/**
 * Hook para auto-save de respostas de assessment
 *
 * Monitora mudanças em `responses` e salva automaticamente após 3 segundos de inatividade.
 * Usa a função `save()` fornecida pelo useAssessmentResponses.
 *
 * @param props - Configurações do auto-save
 * @returns Estado de saving, último save, erro e função para salvar manualmente
 *
 * @example
 * ```tsx
 * const { responses, save } = useAssessmentResponses({ ... });
 * const { isSaving, lastSaved, saveNow } = useAssessmentAutoSave({
 *   responses,
 *   save,
 *   enabled: true
 * });
 * ```
 */
export function useAssessmentAutoSave(
  props: UseAssessmentAutoSaveProps
): UseAssessmentAutoSaveReturn {
  const { responses, save, enabled = true } = props;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const previousValuesRef = useRef<string>('');

  // Auto-save com debounce de 3 segundos
  useEffect(() => {
    if (!enabled || !save) return;

    // Converter valores para string para comparar mudanças
    const currentValuesStr = JSON.stringify(responses);

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
      saveResponses();
    }, 3000);

    // Cleanup
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [responses, enabled, save]);

  /**
   * Salva respostas usando a função save fornecida
   */
  const saveResponses = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Verificar se há respostas para salvar
      const responsesToSave = Object.entries(responses).filter(([, response]) => {
        return (
          response &&
          response.selected_level &&
          response.selected_level.trim() !== ''
        );
      });

      if (responsesToSave.length === 0) {
        console.log('⚠️ [useAssessmentAutoSave] Nenhuma resposta para salvar (todas vazias)');
        setIsSaving(false);
        return;
      }

      console.log(`💾 [useAssessmentAutoSave] Auto-saving ${responsesToSave.length} resposta(s)...`);

      // Chamar função save fornecida (do useAssessmentResponses)
      await save();

      setLastSaved(new Date());
      console.log(`✅ [useAssessmentAutoSave] Auto-save concluído: ${responsesToSave.length} resposta(s) salva(s)`);
    } catch (err: any) {
      console.error('❌ [useAssessmentAutoSave] Erro no auto-save:', err);
      setError(err.message || 'Erro ao salvar');
      toast.error('Erro ao salvar dados automaticamente');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Salva imediatamente (sem debounce)
   */
  const saveNow = async () => {
    // Cancelar save agendado
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Salvar imediatamente
    await saveResponses();
  };

  return {
    isSaving,
    lastSaved,
    error,
    saveNow,
  };
}
