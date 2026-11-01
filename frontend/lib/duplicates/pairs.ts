/**
 * Pair vocabulary for duplicate review: which pairs a status view shows, which
 * pair a URL selects, which exact pairs a bulk accept may take, and which
 * fields differ between the two sides.
 */
import type {DuplicatePair, DuplicatesRead} from '@/services/duplicatesService';

export type DuplicateStatusView = 'open' | 'exact' | 'likely' | 'possible' | 'resolved';

export function pairKey(pair: Pick<DuplicatePair, 'article_id' | 'kept_article_id'>): string {
  return `${pair.article_id}~${pair.kept_article_id}`;
}

export function pairsInView(data: DuplicatesRead, view: DuplicateStatusView): DuplicatePair[] {
  if (view === 'resolved') return data.resolved;
  if (view === 'open') return data.open;
  return data.open.filter((p) => p.tier === view);
}

export function viewCounts(data: DuplicatesRead): Record<DuplicateStatusView, number> {
  return {
    open: data.open.length,
    exact: pairsInView(data, 'exact').length,
    likely: pairsInView(data, 'likely').length,
    possible: pairsInView(data, 'possible').length,
    resolved: data.resolved.length,
  };
}

const hasSide = (p: DuplicatePair, id: string) => p.article_id === id || p.kept_article_id === id;

export function findSelectedPair(
  data: DuplicatesRead,
  articleId: string | null,
  keptId: string | null,
): DuplicatePair | null {
  if (!articleId) return null;
  if (keptId) {
    return [...data.open, ...data.resolved].find((p) => p.article_id === articleId && p.kept_article_id === keptId) ?? null;
  }
  return data.open.find((p) => hasSide(p, articleId)) ?? data.resolved.find((p) => hasSide(p, articleId)) ?? null;
}

/**
 * Exact pairs a bulk accept can post in one batch: in list order, without a
 * removed side that has review work, and without a pair touching a record an
 * earlier pair already removed (a chain the server would refuse as a whole).
 */
export function selectAcceptableExact(open: DuplicatePair[], max = 500): DuplicatePair[] {
  const removedSoFar = new Set<string>();
  const keptSoFar = new Set<string>();
  const accepted: DuplicatePair[] = [];
  for (const p of open) {
    if (accepted.length >= max) break;
    if (p.tier !== 'exact') continue;
    if (p.removed.has_review_work) continue;
    if (removedSoFar.has(p.kept_article_id) || removedSoFar.has(p.article_id) || keptSoFar.has(p.article_id)) continue;
    removedSoFar.add(p.article_id);
    keptSoFar.add(p.kept_article_id);
    accepted.push(p);
  }
  return accepted;
}

export const COMPARE_FIELDS = [
  'title',
  'authors',
  'publication_year',
  'journal_title',
  'doi',
  'pmid',
  'ingestion_source',
  'has_pdf',
  'screening_decisions',
] as const;

export type CompareField = (typeof COMPARE_FIELDS)[number];

const norm = (v: string | null) => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function differingFields(pair: DuplicatePair): Set<CompareField> {
  const a = pair.removed;
  const b = pair.kept;
  const out = new Set<CompareField>();
  for (const f of COMPARE_FIELDS) {
    const differs =
      f === 'title' || f === 'journal_title'
        ? norm(a[f]) !== norm(b[f])
        : f === 'authors'
          ? a.authors.join('; ') !== b.authors.join('; ')
          : a[f] !== b[f];
    if (differs) out.add(f);
  }
  return out;
}
