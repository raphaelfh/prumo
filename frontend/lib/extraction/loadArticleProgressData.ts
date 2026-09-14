/**
 * Worklist/dashboard progress payload: instances for a project template,
 * plus the current user's states and human proposals.
 *
 * PostgREST defaults to a 1000-row page and encodes `.in()` filters in the
 * query string. After entry-group trees, one CHARMS project easily exceeds
 * both (1000+ instances). A single unpaged select or one oversized URL
 * fails the whole query; the worklist then treats every article as not
 * started. So: page the instance read, and batch the value reads per
 * article so neither the instance nor the form-run filter grows with the
 * size of the project.
 */
import { supabase } from '@/integrations/supabase/client';
import { ExtractionValueService } from '@/services/extractionValueService';
import {
  buildArticleValueMap,
  type ArticleProgressData,
  type RawProposal,
  type RawState,
} from '@/lib/extraction/articleValues';
import type { ReviewKind } from '@/lib/comparison/permissions';

/** PostgREST default max-rows. A range shorter than this is the last page. */
const POSTGREST_PAGE = 1000;

/**
 * Uuids per value request, counting BOTH `.in()` filters: the gateway
 * rejects on total URL length, not on either filter alone. 100 × ~38 bytes
 * ≈ 4 KB, half the usual 8 KB limit, embed included.
 */
const UUIDS_PER_VALUE_REQUEST = 100;

interface ValueBatch {
  instanceIds: string[];
  /** null for QA, which has no extraction form run to scope by. */
  runIds: string[] | null;
}

interface InstanceRow {
  id: string;
  article_id: string | null;
  entity_type_id: string;
}

async function selectAllInstances(
  projectId: string,
  templateId: string,
): Promise<InstanceRow[]> {
  const rows: InstanceRow[] = [];
  let from = 0;
  for (;;) {
    const page = await supabase
      .from('extraction_instances')
      .select('id, article_id, entity_type_id')
      .eq('project_id', projectId)
      .eq('template_id', templateId)
      .order('id')
      .range(from, from + POSTGREST_PAGE - 1);
    if (page.error) throw page.error;
    const batch = (page.data ?? []) as InstanceRow[];
    rows.push(...batch);
    if (batch.length < POSTGREST_PAGE) break;
    from += POSTGREST_PAGE;
  }
  return rows;
}

/**
 * Split the value reads into requests that carry an article's instances and
 * that article's form run together. Scoping by every run in the project
 * would grow the query string by one uuid per article — the same URL
 * overflow this loader exists to avoid, just on the other filter.
 *
 * An article with no form run is left out of the reads — it cannot have
 * values yet — but still reaches the map through its instances, as 0%.
 */
function buildValueBatches(
  instances: InstanceRow[],
  runByArticle: Map<string, string> | null,
): ValueBatch[] {
  const idsByArticle = new Map<string, string[]>();
  for (const i of instances) {
    if (i.article_id == null) continue;
    const list = idsByArticle.get(i.article_id) ?? [];
    list.push(i.id);
    idsByArticle.set(i.article_id, list);
  }

  const batches: ValueBatch[] = [];
  let instanceIds: string[] = [];
  let runIds = new Set<string>();
  const flush = () => {
    if (instanceIds.length === 0) return;
    batches.push({
      instanceIds,
      runIds: runByArticle === null ? null : [...runIds],
    });
    instanceIds = [];
    runIds = new Set();
  };

  for (const [articleId, ids] of idsByArticle) {
    const runId = runByArticle?.get(articleId);
    if (runByArticle !== null && runId == null) continue;
    for (const id of ids) {
      const addsRun = runId != null && !runIds.has(runId) ? 1 : 0;
      if (
        instanceIds.length + runIds.size + 1 + addsRun >
        UUIDS_PER_VALUE_REQUEST
      ) {
        flush();
      }
      instanceIds.push(id);
      if (runId != null) runIds.add(runId);
    }
  }
  flush();
  return batches;
}

async function selectBatched<T>(
  batches: ValueBatch[],
  fetchBatch: (
    batch: ValueBatch,
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (const batch of batches) {
    const res = await fetchBatch(batch);
    if (res.error) throw res.error;
    out.push(...((res.data ?? []) as T[]));
  }
  return out;
}

export async function loadArticleProgressData(
  projectId: string,
  templateId: string,
  userId: string,
  kind: ReviewKind,
): Promise<Map<string, ArticleProgressData>> {
  const instances = await selectAllInstances(projectId, templateId);
  if (instances.length === 0) return new Map();

  // An instance survives across runs of the same template+article, so
  // extraction values must be scoped to each article's current form run —
  // otherwise a stale finalized run marks a fresh article "completed". QA
  // has no extraction form run, so it scopes by instance + reviewer only.
  let runByArticle: Map<string, string> | null = null;
  if (kind === 'extraction') {
    const articleIds = Array.from(
      new Set(
        instances
          .map((i) => i.article_id)
          .filter((a): a is string => a != null),
      ),
    );
    runByArticle = await ExtractionValueService.findFormRunsByArticle(
      articleIds,
      templateId,
      projectId,
    );
  }

  const batches = buildValueBatches(instances, runByArticle);
  const [stateRows, proposalRows] = await Promise.all([
    selectBatched<Record<string, unknown>>(batches, (batch) => {
      let q = supabase
        .from('extraction_reviewer_states')
        .select(
          `instance_id, current_decision_id,
           reviewer_decision:extraction_reviewer_decisions!fk_extraction_reviewer_states_decision_run_match(field_id, value, decision)`,
        )
        .in('instance_id', batch.instanceIds)
        .eq('reviewer_id', userId);
      if (batch.runIds !== null) q = q.in('run_id', batch.runIds);
      return q;
    }),
    selectBatched<Record<string, unknown>>(batches, (batch) => {
      let q = supabase
        .from('extraction_proposal_records')
        .select('instance_id, field_id, proposed_value, created_at')
        .in('instance_id', batch.instanceIds)
        .eq('source', 'human')
        .eq('source_user_id', userId)
        .order('created_at', { ascending: false });
      if (batch.runIds !== null) q = q.in('run_id', batch.runIds);
      return q;
    }),
  ]);

  const states: RawState[] = [];
  for (const row of stateRows) {
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
  const proposals: RawProposal[] = proposalRows.map((p) => ({
    instance_id: p.instance_id as string,
    field_id: p.field_id as string,
    proposed_value: p.proposed_value,
  }));

  return buildArticleValueMap(instances, states, proposals);
}
