export interface RawInstance {
  id: string;
  article_id: string | null;
  entity_type_id: string;
}
export interface RawState {
  instance_id: string;
  field_id: string;
  value: unknown;
  decision: string;
}
export interface RawProposal {
  instance_id: string;
  field_id: string;
  proposed_value: unknown;
}

export interface ArticleValueRow {
  instance_id: string;
  field_id: string;
  value: unknown;
}
export interface ArticleProgressData {
  instances: Array<{ id: string; entity_type_id: string }>;
  values: ArticleValueRow[];
}

function unwrap(raw: unknown): unknown {
  return raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
    ? (raw as { value: unknown }).value
    : raw;
}

/**
 * Build the per-article `{instances, values}` map used by the list tables and
 * the dashboard to compute completion — one copy of the logic the three
 * surfaces used to duplicate.
 *
 * Values come from the current user's non-reject reviewer_states (first per
 * coord) PLUS their human proposals (first per coord; empty values skipped).
 * A reject decision does NOT claim the coord, so a later human proposal can
 * still fill it (matches the previous per-table behaviour).
 */
export function buildArticleValueMap(
  instances: RawInstance[],
  states: RawState[],
  proposals: RawProposal[],
): Map<string, ArticleProgressData> {
  const instancesById = new Map<string, RawInstance>();
  for (const i of instances) instancesById.set(i.id, i);

  const valuesByInstance = new Map<string, ArticleValueRow[]>();
  const seen = new Set<string>();
  const push = (instance_id: string, field_id: string, value: unknown) => {
    const list = valuesByInstance.get(instance_id) ?? [];
    list.push({ instance_id, field_id, value });
    valuesByInstance.set(instance_id, list);
  };

  for (const s of states) {
    if (s.decision === 'reject') continue;
    const key = `${s.instance_id}_${s.field_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    push(s.instance_id, s.field_id, s.value);
  }
  for (const p of proposals) {
    const key = `${p.instance_id}_${p.field_id}`;
    if (seen.has(key)) continue;
    const u = unwrap(p.proposed_value);
    if (u === '' || u == null) continue;
    seen.add(key);
    push(p.instance_id, p.field_id, p.proposed_value);
  }

  const map = new Map<string, ArticleProgressData>();
  for (const i of instances) {
    if (i.article_id == null) continue;
    const entry = map.get(i.article_id) ?? { instances: [], values: [] };
    entry.instances.push({ id: i.id, entity_type_id: i.entity_type_id });
    map.set(i.article_id, entry);
  }
  for (const [instanceId, vals] of valuesByInstance) {
    const articleId = instancesById.get(instanceId)?.article_id;
    if (articleId == null) continue;
    map.get(articleId)?.values.push(...vals);
  }
  return map;
}
