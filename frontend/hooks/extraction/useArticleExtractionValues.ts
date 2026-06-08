/**
 * Shared per-article extraction/QA values, TanStack-cached by
 * `(projectId, templateId, userId, kind)`. Replaces the near-identical
 * Supabase fetch the HITL list, the extraction table and the dashboard each
 * used to build per-article `{instances, values}` for progress. Scoped to the
 * current user (same `reviewer_id` / `source_user_id` filter as before).
 *
 * Run-scoping is kind-aware: for `extraction` the value reads are scoped to
 * each article's *form run* (instances persist across runs of the same
 * template+article, so a stale finalized run would otherwise mark a fresh
 * article "completed"). For `quality_assessment` there is no extraction
 * form-run, so the reads are scoped only by instance + reviewer (the prior
 * QA-list behaviour).
 */

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { ExtractionValueService } from '@/services/extractionValueService';
import {
  buildArticleValueMap,
  type ArticleProgressData,
  type RawProposal,
  type RawState,
} from '@/lib/extraction/articleValues';

type ValuesKind = 'extraction' | 'quality_assessment';

export const articleExtractionValuesKeys = {
  all: ['article-extraction-values'] as const,
  byTemplate: (projectId: string, templateId: string, userId: string, kind: string) =>
    ['article-extraction-values', projectId, templateId, userId, kind] as const,
};

export function useArticleExtractionValues(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
  userId: string | null | undefined,
  kind: ValuesKind = 'extraction',
) {
  const query = useQuery({
    queryKey: articleExtractionValuesKeys.byTemplate(
      projectId ?? '',
      templateId ?? '',
      userId ?? '',
      kind,
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

      // Extraction: scope value reads to each article's form run. QA has no
      // extraction form-run, so it stays unscoped (instance + reviewer only).
      let runIds: string[] | null = null;
      if (kind === 'extraction') {
        const articleIds = Array.from(
          new Set(instances.map((i) => i.article_id).filter((a): a is string => a != null)),
        );
        const formRunByArticle = await ExtractionValueService.findFormRunsByArticle(
          articleIds,
          templateId as string,
        );
        runIds = Array.from(new Set(formRunByArticle.values()));
      }

      const states: RawState[] = [];
      const proposals: RawProposal[] = [];
      // For extraction with no form runs there is nothing to read; the
      // instances still populate the map (values stay empty → 0% progress).
      const hasValues = kind !== 'extraction' || (runIds !== null && runIds.length > 0);
      if (hasValues) {
        let statesQuery = supabase
          .from('extraction_reviewer_states')
          .select(
            `instance_id, current_decision_id,
             reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match(field_id, value, decision)`,
          )
          .in('instance_id', instanceIds)
          .eq('reviewer_id', userId as string);
        let proposalsQuery = supabase
          .from('extraction_proposal_records')
          .select('instance_id, field_id, proposed_value, created_at')
          .in('instance_id', instanceIds)
          .eq('source', 'human')
          .eq('source_user_id', userId as string)
          .order('created_at', { ascending: false });
        if (runIds !== null) {
          statesQuery = statesQuery.in('run_id', runIds);
          proposalsQuery = proposalsQuery.in('run_id', runIds);
        }
        const [statesRes, proposalsRes] = await Promise.all([statesQuery, proposalsQuery]);
        if (statesRes.error) throw statesRes.error;
        if (proposalsRes.error) throw proposalsRes.error;

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
        for (const p of (proposalsRes.data ?? []) as Array<Record<string, unknown>>) {
          proposals.push({
            instance_id: p.instance_id as string,
            field_id: p.field_id as string,
            proposed_value: p.proposed_value,
          });
        }
      }

      return buildArticleValueMap(instances, states, proposals);
    },
  });

  return {
    valuesByArticle: query.data ?? new Map<string, ArticleProgressData>(),
    isLoading: query.isLoading,
    error: query.error,
  };
}
