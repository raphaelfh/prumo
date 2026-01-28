/**
 * Hook para calcular progresso de assessment instance
 *
 * Usa a função SQL calculate_assessment_instance_progress()
 * para obter progresso preciso (total items vs answered items).
 *
 * @see calculate_assessment_instance_progress() - Função SQL no banco
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AssessmentInstanceProgress } from '@/types/assessment';

interface UseAssessmentInstanceProgressProps {
  instanceId: string | null | undefined;
  enabled?: boolean;
}

export function useAssessmentInstanceProgress({
  instanceId,
  enabled = true,
}: UseAssessmentInstanceProgressProps) {
  const [progress, setProgress] = useState<AssessmentInstanceProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Calcular progresso usando função SQL
  const calculateProgress = useCallback(async () => {
    if (!enabled || !instanceId) {
      setProgress(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Chamar função SQL
      const { data, error: rpcError } = await supabase.rpc(
        'calculate_assessment_instance_progress',
        { p_instance_id: instanceId }
      );

      if (rpcError) throw rpcError;

      if (data && data.length > 0) {
        setProgress({
          total_items: data[0].total_items,
          answered_items: data[0].answered_items,
          completion_percentage: data[0].completion_percentage,
        });
      } else {
        setProgress({
          total_items: 0,
          answered_items: 0,
          completion_percentage: 0,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao calcular progresso';
      console.error('Erro ao calcular progresso:', err);
      setError(message);
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, instanceId]);

  // Calcular ao montar e quando instanceId mudar
  useEffect(() => {
    calculateProgress();
  }, [calculateProgress]);

  return {
    progress,
    loading,
    error,

    // Manual reload
    recalculate: calculateProgress,
  };
}
