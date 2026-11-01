/**
 * Display rules for the screened record's meta line: which language and
 * article-type values earn a chip, and the PubMed link for a PMID.
 */
import {formatZoteroItemTypeForDisplay} from '@/lib/zoteroItemTypes';

const ENGLISH = new Set(['eng', 'en', 'english']);
const ENGLISH_TAG = /^en[-_]/;

const LANGUAGE_NAMES: Record<string, string> = {
  spa: 'Spanish',
  por: 'Portuguese',
  fre: 'French',
  ger: 'German',
  chi: 'Chinese',
  jpn: 'Japanese',
  ita: 'Italian',
  rus: 'Russian',
  dut: 'Dutch',
  kor: 'Korean',
};

const GENERIC_JOURNAL_ARTICLE = new Set(['journal article', 'journalarticle', 'jour']);

const PMID = /^\d+$/;

/** null for English or an empty value; else a language name or the raw value. */
export function languageChipLabel(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  const key = value.toLowerCase();
  if (ENGLISH.has(key) || ENGLISH_TAG.test(key)) return null;
  return LANGUAGE_NAMES[key] ?? value;
}

/** null for an empty value or a generic journal article; else a display label. */
export function articleTypeChipLabel(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '' || GENERIC_JOURNAL_ARTICLE.has(value.toLowerCase())) return null;
  return formatZoteroItemTypeForDisplay(value);
}

/** The PubMed page for a numeric PMID, else null. */
export function pubmedUrl(pmid: string | null | undefined): string | null {
  const value = pmid?.trim() ?? '';
  return PMID.test(value) ? `https://pubmed.ncbi.nlm.nih.gov/${value}/` : null;
}
