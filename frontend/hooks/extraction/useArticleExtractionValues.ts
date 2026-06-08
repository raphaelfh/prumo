/**
 * Shared per-article extraction values, TanStack-cached by
 * `(projectId, templateId, userId)`. Replaces the near-identical Supabase
 * fetch that the HITL list, the extraction table and the dashboard each used
 * to build per-article `{instances, values}` for progress. Scoped to the
 * current user (same `reviewer_id` / `source_user_id` filter as before).
 */

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import {
  buildArticleValueMap,
  type ArticleProgressData,
  type RawProposal,
  type RawState,
} from '@/lib/extraction/articleValues';

export const articleExtractionValuesKeys = {
  all: ['article-extraction-values'] as const,
  byTemplate: (projectId: string, templateId: string, userId: string) =>
    ['article-extraction-values', projectId, templateId, userId] as const,
};

export function useArticleExtractionValues(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
  userId: string | null | undefined,
) {
  const query = useQuery({
    queryKey: articleExtractionValuesKeys.byTemplate(
      projectId ?? '',
      templateId ?? '',
      userId ?? '',
    ),
    enabled: !!projectId && !!templateId && !!userId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Map<string, ArticleProgressData>> => {
      const instRes = await supabase
        .from('extraction_instances')
        .select('id, article_id, entity_type_id, status')
        .eq('project_id', projectId as string)
        .eq('template_id', templateId as string);
      if (instRes.error) throw instRes.error;
      const instances = (instRes.data ?? []) as Array<{
        id: string;
        article_id: string | null;
        entity_type_id: string;
        status?: string;
      }>;
      const instanceIds = instances.map((i) => i.id);
      if (instanceIds.length === 0) return new Map();

      const [statesRes, proposalsRes] = await Promise.all([
        supabase
          .from('extraction_reviewer_states')
          .select(
            `instance_id, current_decision_id,
             reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match(field_id, value, decision)`,
          )
          .in('instance_id', instanceIds)
          .eq('reviewer_id', userId as string),
        supabase
          .from('extraction_proposal_records')
          .select('instance_id, field_id, proposed_value, created_at')
          .in('instance_id', instanceIds)
          .eq('source', 'human')
          .eq('source_user_id', userId as string)
          .order('created_at', { ascending: false }),
      ]);
      if (statesRes.error) throw statesRes.error;
      if (proposalsRes.error) throw proposalsRes.error;

      const states: RawState[] = [];
      for (const row of (statesRes.data ?? []) as Array<Record<string, unknown>>) {
        const dec = Array.isArray(row.reviewer_decision)
          ? row.reviewer_decision[0]
          : row.reviewer_decision;
        if (!dec) continue;
        const d = dec as { field_id: string; value: unknown; decision: string };
        states.push({
          instance_id: row.instance_id as string,
          field_id: d.field_id,
          value: d.value,
          decision: d.decision,
        });
      }
      const proposals: RawProposal[] = (
        (proposalsRes.data ?? []) as Array<Record<string, unknown>>
      ).map((p) => ({
        instance_id: p.instance_id as string,
        field_id: p.field_id as string,
        proposed_value: p.proposed_value,
      }));

      return buildArticleValueMap(instances, states, proposals);
    },
  });

  return {
    valuesByArticle: query.data ?? new Map<string, ArticleProgressData>(),
    isLoading: query.isLoading,
    error: query.error,
  };
}
