/**
 * The full-text decision pane (spec §7.3): where the report came from at
 * title/abstract, a "No PDF attached" line when the row has no main file
 * (deciding stays allowed), then the full-text decision buttons with their note.
 */
import {t} from '@/lib/copy';
import type {ScreeningDecisionCreate, ScreeningRecordRow} from '@/services/screeningService';

import {DecisionButtons} from './DecisionButtons';

const TA_KIND_LABEL = {consensus: 'outcomeConsensus', arbitrated: 'outcomeArbitrated'} as const;

/** "Included at title/abstract · 2 reviewers, consensus", or null without a TA outcome. */
function taProvenance(row: ScreeningRecordRow): string | null {
  const {ta_outcome: outcome, ta_outcome_kind: kind, ta_reviewer_count: count} = row;
  if (outcome === null || kind === null) return null;
  const maybe = outcome === 'maybe';
  if (kind === 'solo') return t('screening', maybe ? 'taProvenanceMaybeSolo' : 'taProvenanceSolo');
  return t('screening', maybe ? 'taProvenanceMaybe' : 'taProvenance')
    .replace('{{n}}', String(count ?? ''))
    .replace('{{kind}}', t('screening', TA_KIND_LABEL[kind]));
}

export interface FullTextDecisionPaneProps {
  row: ScreeningRecordRow;
  reasons: string[];
  busy: boolean;
  /** A solo record's own decision (the recorded-choice ring). */
  recorded?: ScreeningDecisionCreate['decision'] | null;
  recordedReason?: string | null;
  onDecide: (body: ScreeningDecisionCreate) => void;
}

export function FullTextDecisionPane({row, reasons, busy, recorded, recordedReason, onDecide}: FullTextDecisionPaneProps) {
  const provenance = taProvenance(row);
  return (
    <div className="flex flex-col gap-2">
      {provenance && <p className="text-xs text-muted-foreground">{provenance}</p>}
      {!row.has_pdf && <p className="text-xs text-muted-foreground">{t('screening', 'noPdfAttached')}</p>}
      <DecisionButtons
        reasons={reasons}
        disabled={busy}
        onDecide={onDecide}
        phase="full_text"
        recorded={recorded}
        recordedReason={recordedReason}
      />
    </div>
  );
}
