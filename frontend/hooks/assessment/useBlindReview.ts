import {useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {getResponseLevel} from '@/lib/assessment-utils';

export interface DiscordanceData {
  articleId: string;
  instrumentId: string;
  totalItems: number;
  discordantItems: number;
  discordancePercentage: number;
}

export interface BlindReviewState {
  isBlindMode: boolean;
  canManageBlindMode: boolean;
  isLoading: boolean;
  error: string | null;
}

export const useBlindReview = (projectId: string, userId: string) => {
  const [blindState, setBlindState] = useState<BlindReviewState>({
    isBlindMode: false,
    canManageBlindMode: false,
    isLoading: true,
    error: null
  });

  const [discordanceData, setDiscordanceData] = useState<DiscordanceData[]>([]);

  // Carrega configuração do blind mode e permissões do usuário
  useEffect(() => {
    loadBlindReviewState();
  }, [projectId, userId]);

  const loadBlindReviewState = async () => {
    try {
      setBlindState(prev => ({ ...prev, isLoading: true, error: null }));

      // Busca configuração do projeto
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('settings')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

      // Verifica se o usuário é manager
      const { data: member, error: memberError } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

      if (memberError) throw memberError;

      const isBlindMode = project.settings?.blind_mode || false;
      const canManageBlindMode = member.role === 'manager';

      setBlindState({
        isBlindMode,
        canManageBlindMode,
        isLoading: false,
        error: null
      });

      // Se não estiver em blind mode, carrega dados de discordância
      if (!isBlindMode) {
        await loadDiscordanceData();
      } else {
        setDiscordanceData([]);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao carregar modo blind';
      console.error('Error loading blind review state:', error);
      setBlindState({
        isBlindMode: false,
        canManageBlindMode: false,
        isLoading: false,
        error: message
      });
    }
  };

  const loadDiscordanceData = async () => {
    try {
      // Query para calcular discordâncias entre assessments
      const { data, error } = await supabase.rpc('calculate_assessment_discordances', {
        project_id: projectId
      });

      if (error) {
        console.warn('Error calculating discordances:', error);
        // Fallback: calcular no frontend se a função RPC não existir
        await calculateDiscordancesFallback();
      } else {
        setDiscordanceData(data || []);
      }
    } catch (error) {
      console.error('Error loading discordance data:', error);
      await calculateDiscordancesFallback();
    }
  };

  const calculateDiscordancesFallback = async () => {
    try {
      // Busca todos os assessments submitted para o projeto (de todos os usuários)
      // Isso é necessário para calcular discordâncias entre diferentes reviewers
      const { data: assessments, error } = await supabase
        .from('assessments')
        .select(`
          article_id,
          instrument_id,
          user_id,
          responses,
          is_blind
        `)
        .eq('project_id', projectId)
        .eq('status', 'submitted')
        .eq('is_blind', false);

      if (error) throw error;

      // Agrupa por artigo e instrumento
      const groupedAssessments = assessments.reduce((acc, assessment) => {
        const key = `${assessment.article_id}-${assessment.instrument_id}`;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(assessment);
        return acc;
      }, {} as Record<string, typeof assessments>);

      // Calcula discordâncias para cada grupo
      const discordances: DiscordanceData[] = [];

      Object.entries(groupedAssessments).forEach(([key, groupAssessments]) => {
        if (groupAssessments.length < 2) return; // Precisa de pelo menos 2 assessments

        const [articleId, instrumentId] = key.split('-');
        const allItemIds = new Set<string>();

        // Coleta todos os item_ids
        groupAssessments.forEach(assessment => {
          Object.keys(assessment.responses || {}).forEach(itemId => {
            allItemIds.add(itemId);
          });
        });

        let discordantItems = 0;

        // Para cada item, verifica se há discordância
        allItemIds.forEach(itemId => {
          const responses = groupAssessments
            .map(a => getResponseLevel(a.responses?.[itemId]))
            .filter(Boolean);

          if (responses.length > 1) {
            // Verifica se todos as respostas são iguais
            const uniqueResponses = new Set(responses);
            if (uniqueResponses.size > 1) {
              discordantItems++;
            }
          }
        });

        const totalItems = allItemIds.size;
        const discordancePercentage = totalItems > 0 
          ? Math.round((discordantItems / totalItems) * 100 * 10) / 10 
          : 0;

        discordances.push({
          articleId,
          instrumentId,
          totalItems,
          discordantItems,
          discordancePercentage
        });
      });

      setDiscordanceData(discordances);
    } catch (error) {
      console.error('Error in discordance fallback calculation:', error);
    }
  };

  const toggleBlindMode = async () => {
    if (!blindState.canManageBlindMode) {
      throw new Error('Apenas managers podem alterar o modo blind');
    }

    try {
      const newBlindMode = !blindState.isBlindMode;

      const { error } = await supabase
        .from('projects')
        .update({
          settings: {
            blind_mode: newBlindMode
          }
        })
        .eq('id', projectId);

      if (error) throw error;

      setBlindState(prev => ({
        ...prev,
        isBlindMode: newBlindMode
      }));

      // Se desativando blind mode, recarrega dados de discordância
      if (!newBlindMode) {
        await loadDiscordanceData();
      } else {
        setDiscordanceData([]);
      }

      return newBlindMode;
    } catch (error) {
      console.error('Error toggling blind mode:', error);
      throw error;
    }
  };

  const getDiscordanceForArticle = (articleId: string, instrumentId: string): DiscordanceData | null => {
    return discordanceData.find(
      d => d.articleId === articleId && d.instrumentId === instrumentId
    ) || null;
  };

  const refreshDiscordanceData = async () => {
    if (!blindState.isBlindMode) {
      await loadDiscordanceData();
    } else {
      setDiscordanceData([]);
    }
  };

  return {
    ...blindState,
    discordanceData,
    toggleBlindMode,
    getDiscordanceForArticle,
    refreshDiscordanceData
  };
};
