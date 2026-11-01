/**
 * An article's screening stage for the Articles list chip: one label, an
 * optional phase prefix, and a tone. Pure over the phase-less records read
 * (`ScreeningRecordRow`, one row per article) and the project's full-text
 * switch. The prefix says which phase an open or provisional status belongs
 * to; a terminal status (excluded, full-text included) stands alone.
 */
import {RECORD_STATUS_LABEL, RECORD_STATUS_TONE} from '@/components/screening/RecordStatusChip';
import type {screening} from '@/lib/copy/screening';
import type {ScreeningRecordRow} from '@/services/screeningService';

type ScreeningCopyKey = keyof typeof screening;

export type ArticleStage = {
  label: ScreeningCopyKey;
  prefix: 'tabTitleAbstract' | 'tabFullText' | null;
  tone: string;
};

export function articleScreeningStage(
  row: ScreeningRecordRow | undefined,
  opts: {fullTextOn: boolean; isDuplicate: boolean},
): ArticleStage | null {
  if (opts.isDuplicate) {
    return {label: 'stageDuplicate', prefix: null, tone: RECORD_STATUS_TONE.not_enrolled};
  }
  if (!row) return null;

  const {status, phase} = row;
  const label = RECORD_STATUS_LABEL[status];
  const tone = RECORD_STATUS_TONE[status];
  const prefixOf = phase === 'full_text' ? 'tabFullText' : 'tabTitleAbstract';

  if (status === 'not_enrolled' || status === 'excluded') return {label, prefix: null, tone};
  if (status === 'included') {
    // A full-text inclusion is final; a title/abstract one only passes the article on while full text is on.
    return {label, prefix: phase === 'title_abstract' && opts.fullTextOn ? 'tabTitleAbstract' : null, tone};
  }
  return {label, prefix: prefixOf, tone};
}
