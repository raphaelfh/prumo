---
status: shipped
last_reviewed: 2026-06-08
owner: '@raphaelfh'
---

# Shared article-extraction values hook + dashboard progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three near-identical Supabase fetches that build per-article extraction values (HITLArticleTable, ArticleExtractionTable, the ExtractionInterface dashboard) with one shared hook, and fix the dashboard's "Overall progress" so it shows the mean of the canonical per-article field completion instead of "% of articles touched".

**Architecture:** Extract the value-shaping (instances + reviewer_states + human proposals → per-article `{instances, values}`) into a pure function, wrap it in a TanStack-cached hook `useArticleExtractionValues(projectId, templateId)`, and have all three surfaces consume it + the existing `computeRowProgress`. Verified: both tables use the fetched instances/values ONLY for `computeRowProgress` and `instances.length` checks (no per-value rendering), so the fetch can be fully centralized.

**Tech Stack:** React 18, TS strict, TanStack Query, vitest. Patterns: pure-function extraction (`frontend/lib/extraction/*`), key-factory queryKeys (fitness gate forbids literal `queryKey: [`), atomic commits on `fix/extraction-stale-blind-progress`.

---

## File Structure

- Create: `frontend/lib/extraction/articleValues.ts` — pure `buildArticleValueMap(...)` (the shaping).
- Create: `frontend/lib/extraction/articleValues.test.ts` — unit tests.
- Create: `frontend/hooks/extraction/useArticleExtractionValues.ts` — TanStack hook + key factory.
- Modify: `frontend/components/hitl/HITLArticleTable.tsx` — drop its instances/values fetch; consume the hook.
- Modify: `frontend/components/extraction/ArticleExtractionTable.tsx` — same.
- Modify: `frontend/components/extraction/ExtractionInterface.tsx` — dashboard uses the hook + `useTemplateEntityTypes`; "Overall progress" = mean per-article completion.

---

### Task 1: Pure value-shaping function

**Files:**
- Create: `frontend/lib/extraction/articleValues.ts`
- Test: `frontend/lib/extraction/articleValues.test.ts`

The shaping mirrors today's table logic: per article, values come from the current user's non-reject reviewer_states (first per coord) PLUS their human proposals (first per coord, newest-first, skipping empty), deduped by `${instance}_${field}`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/lib/extraction/articleValues.test.ts
import { describe, expect, it } from 'vitest';
import { buildArticleValueMap, type RawInstance, type RawState, type RawProposal } from './articleValues';

const inst = (id: string, article_id: string, entity_type_id = 'e1', status = 'pending'): RawInstance =>
  ({ id, article_id, entity_type_id, status });

describe('buildArticleValueMap', () => {
  it('groups instances + values per article', () => {
    const instances = [inst('i1', 'a1'), inst('i2', 'a2')];
    const states: RawState[] = [{ instance_id: 'i1', field_id: 'f1', value: { value: 'x' }, decision: 'edit' }];
    const proposals: RawProposal[] = [];
    const map = buildArticleValueMap(instances, states, proposals);
    expect(map.get('a1')?.instances.map((i) => i.id)).toEqual(['i1']);
    expect(map.get('a1')?.values).toEqual([{ instance_id: 'i1', field_id: 'f1', value: { value: 'x' } }]);
    expect(map.get('a2')?.values).toEqual([]);
  });

  it('drops reject decisions and dedups state-vs-proposal by coord (state wins)', () => {
    const instances = [inst('i1', 'a1')];
    const states: RawState[] = [
      { instance_id: 'i1', field_id: 'f1', value: { value: 'fromState' }, decision: 'edit' },
      { instance_id: 'i1', field_id: 'f2', value: { value: 'r' }, decision: 'reject' },
    ];
    const proposals: RawProposal[] = [
      { instance_id: 'i1', field_id: 'f1', proposed_value: { value: 'fromProposal' } },
      { instance_id: 'i1', field_id: 'f3', proposed_value: { value: 'p3' } },
    ];
    const map = buildArticleValueMap(instances, states, proposals);
    const byCoord = Object.fromEntries(map.get('a1')!.values.map((v) => [`${v.instance_id}_${v.field_id}`, v.value]));
    expect(byCoord['i1_f1']).toEqual({ value: 'fromState' }); // state wins
    expect('i1_f2' in byCoord).toBe(false); // reject dropped
    expect(byCoord['i1_f3']).toEqual({ value: 'p3' }); // proposal contributes
  });

  it('skips empty human proposals (typed-then-erased not counted as filled)', () => {
    const instances = [inst('i1', 'a1')];
    const proposals: RawProposal[] = [{ instance_id: 'i1', field_id: 'f1', proposed_value: { value: '' } }];
    expect(buildArticleValueMap(instances, [], proposals).get('a1')?.values).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/lib/extraction/articleValues.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/lib/extraction/articleValues.ts
export interface RawInstance { id: string; article_id: string | null; entity_type_id: string; status?: string }
export interface RawState { instance_id: string; field_id: string; value: unknown; decision: string }
export interface RawProposal { instance_id: string; field_id: string; proposed_value: unknown }

export interface ArticleValueRow { instance_id: string; field_id: string; value: unknown }
export interface ArticleProgressData {
  instances: Array<{ id: string; entity_type_id: string; status?: string }>;
  values: ArticleValueRow[];
}

function unwrap(raw: unknown): unknown {
  return raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
    ? (raw as { value: unknown }).value
    : raw;
}

/**
 * Build the per-article {instances, values} map used by the list tables and
 * the dashboard to compute completion. Values come from the current user's
 * non-reject reviewer_states (first per coord) plus their human proposals
 * (first per coord; empty values skipped). One copy of the logic the three
 * surfaces used to duplicate.
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
    if (unwrap(p.proposed_value) === '' || unwrap(p.proposed_value) == null) continue;
    seen.add(key);
    push(p.instance_id, p.field_id, p.proposed_value);
  }

  const map = new Map<string, ArticleProgressData>();
  for (const i of instances) {
    if (i.article_id == null) continue;
    const entry = map.get(i.article_id) ?? { instances: [], values: [] };
    entry.instances.push({ id: i.id, entity_type_id: i.entity_type_id, status: i.status });
    map.set(i.article_id, entry);
  }
  for (const [instanceId, vals] of valuesByInstance) {
    const articleId = instancesById.get(instanceId)?.article_id;
    if (articleId == null) continue;
    const entry = map.get(articleId);
    if (entry) entry.values.push(...vals);
  }
  return map;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/lib/extraction/articleValues.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/extraction/articleValues.ts frontend/lib/extraction/articleValues.test.ts
git commit -m "feat(extraction): pure per-article value-map shaping"
```

---

### Task 2: useArticleExtractionValues hook

**Files:**
- Create: `frontend/hooks/extraction/useArticleExtractionValues.ts`

- [ ] **Step 1: Implement (key factory + fetch + shape)**

```ts
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
    queryKey: articleExtractionValuesKeys.byTemplate(projectId ?? '', templateId ?? '', userId ?? ''),
    enabled: !!projectId && !!templateId && !!userId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Map<string, ArticleProgressData>> => {
      const instRes = await supabase
        .from('extraction_instances')
        .select('id, article_id, entity_type_id, status')
        .eq('project_id', projectId as string)
        .eq('template_id', templateId as string);
      if (instRes.error) throw instRes.error;
      const instances = (instRes.data ?? []) as Array<{ id: string; article_id: string | null; entity_type_id: string; status?: string }>;
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
        const dec = Array.isArray(row.reviewer_decision) ? row.reviewer_decision[0] : row.reviewer_decision;
        if (!dec) continue;
        const d = dec as { field_id: string; value: unknown; decision: string };
        states.push({ instance_id: row.instance_id as string, field_id: d.field_id, value: d.value, decision: d.decision });
      }
      const proposals: RawProposal[] = ((proposalsRes.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
        instance_id: p.instance_id as string,
        field_id: p.field_id as string,
        proposed_value: p.proposed_value,
      }));

      return buildArticleValueMap(instances, states, proposals);
    },
  });
  return { valuesByArticle: query.data ?? new Map<string, ArticleProgressData>(), isLoading: query.isLoading, error: query.error };
}
```

- [ ] **Step 2: Typecheck + queryKey fitness gate**

Run: `npm run typecheck && uv run python scripts/fitness/check_react_query_keys.py` (from repo root)
Expected: clean; "0 literal queryKeys".

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/extraction/useArticleExtractionValues.ts
git commit -m "feat(extraction): shared useArticleExtractionValues hook"
```

---

### Task 3: Converge HITLArticleTable onto the hook

**Files:**
- Modify: `frontend/components/hitl/HITLArticleTable.tsx`

- [ ] **Step 1:** Add `const { valuesByArticle, isLoading: valuesLoading } = useArticleExtractionValues(projectId, templateId, currentUserId);`. Remove the instances/reviewer_states/human-proposals fetch from the data `useEffect` (keep the articles fetch); set `articles` to the bare `Article[]`. Change `ArticleWithProgress` usages: build progress from `valuesByArticle`.
- [ ] **Step 2:** `progressByArticle` memo becomes: for each article, `const d = valuesByArticle.get(article.id); map.set(article.id, d ? computeRowProgress(d.instances, d.values, entityTypes) : 0)`. The sort/status checks that read `a.instances.length` read `valuesByArticle.get(a.id)?.instances.length ?? 0`.
- [ ] **Step 3:** Gate loading on `valuesLoading` too. Typecheck + eslint + the existing `frontend/lib/extraction/progress.test.ts` stay green.

Run: `npm run typecheck && npx eslint frontend/components/hitl/HITLArticleTable.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/hitl/HITLArticleTable.tsx
git commit -m "refactor(extraction): HITL list consumes the shared values hook"
```

---

### Task 4: Converge ArticleExtractionTable onto the hook

**Files:**
- Modify: `frontend/components/extraction/ArticleExtractionTable.tsx`

- [ ] **Step 1:** Same shape as Task 3: add the hook, remove the instances/states/proposals fetch from `loadArticles` (keep the articles + any AI/run wiring), drive `getProgress` + `instances.length` checks (lines ~543, ~1124, ~1254) from `valuesByArticle.get(id)`.
- [ ] **Step 2:** Typecheck + eslint clean; gate loading on `valuesLoading`.

Run: `npm run typecheck && npx eslint frontend/components/extraction/ArticleExtractionTable.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/extraction/ArticleExtractionTable.tsx
git commit -m "refactor(extraction): extraction table consumes the shared values hook"
```

---

### Task 5: Dashboard "Overall progress" = mean per-article completion

**Files:**
- Modify: `frontend/components/extraction/ExtractionInterface.tsx`

- [ ] **Step 1:** In the dashboard, add `useArticleExtractionValues(projectId, activeTemplate?.id, user?.id)` and `useTemplateEntityTypes(activeTemplate?.id)`. Replace the `loadExtractionStats` "% articles touched" computation: `extractionsStarted = valuesByArticle.size`; `progressPercentage = round(mean over articles of computeRowProgress(d.instances, d.values, entityTypes))` (0 when no articles). Keep `totalArticles`.
- [ ] **Step 2:** Typecheck + eslint clean.

Run: `npm run typecheck && npx eslint frontend/components/extraction/ExtractionInterface.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/extraction/ExtractionInterface.tsx
git commit -m "fix(extraction): dashboard Overall progress = mean field completion"
```

---

### Task 6: Verification

- [ ] **Step 1:** `npx vitest run frontend/lib/extraction/ frontend/test/hooks/useExtractionProgress.test.tsx` — all green.
- [ ] **Step 2:** `npm run typecheck` clean; `uv run python scripts/fitness/check_react_query_keys.py` 0 literal keys.
- [ ] **Step 3:** Grep that the duplicate fetch is gone: `grep -rn "extraction_reviewer_states" frontend/components/hitl/HITLArticleTable.tsx frontend/components/extraction/ArticleExtractionTable.tsx frontend/components/extraction/ExtractionInterface.tsx` returns nothing (now centralized in the hook).

---

## Self-Review

- **Spec coverage:** hook (Tasks 1–2) + dedup both tables (3–4) + dashboard fix (5) + verification (6). ✓
- **Type consistency:** `buildArticleValueMap(instances, states, proposals)` and `ArticleProgressData {instances, values}` used identically in helper, hook, and all three consumers; `valuesByArticle` name consistent. ✓
- **Placeholders:** Tasks 3–5 describe surgical edits to large existing components without re-pasting the whole file (they say exactly which fetch to remove and which lookups to repoint); the new code (hook + pure fn) is shown in full.
- **Risk:** the tables use instances/values ONLY for progress + `instances.length` (verified by grep), so removing the embedded fetch can't break rendering. The hook is current-user-scoped (same `reviewer_id`/`source_user_id` filter as before) — no new data exposure.
