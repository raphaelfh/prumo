/**
 * Side-by-side compare of one duplicate pair. The kept candidate sits left; a
 * "Keep" radio per column picks the survivor (default: the server's
 * suggestion). Callers key the panel by `pairKey` so the choice resets per pair.
 */
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {COMPARE_FIELDS, differingFields, sourceLabel, type CompareField} from '@/lib/duplicates/pairs';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';
import type {DuplicatePair} from '@/services/duplicatesService';

type Side = DuplicatePair['kept'];

const FIELD_LABEL: Record<CompareField, Parameters<typeof t<'duplicates'>>[1]> = {
  title: 'fieldTitle',
  authors: 'fieldAuthors',
  publication_year: 'fieldYear',
  journal_title: 'fieldJournal',
  doi: 'fieldDoi',
  pmid: 'fieldPmid',
  ingestion_source: 'fieldSource',
  has_pdf: 'fieldPdf',
  screening_decisions: 'fieldScreening',
};

function fieldValue(side: Side, field: CompareField): string {
  switch (field) {
    case 'authors':
      return side.authors.join('; ');
    case 'ingestion_source':
      return sourceLabel(side.ingestion_source);
    case 'has_pdf':
      return side.has_pdf ? t('duplicates', 'yes') : t('duplicates', 'no');
    case 'screening_decisions':
      return t('duplicates', 'decisionsCount').replace('{{n}}', String(side.screening_decisions));
    default:
      return side[field] == null ? '' : String(side[field]);
  }
}

const truncate = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

interface Props {
  pair: DuplicatePair;
  busy: boolean;
  onMerge: (removedId: string, keptId: string) => void;
  onDistinct: () => void;
  onSkip: () => void;
  onUndo: () => void;
}

export function DuplicateComparePanel({pair, busy, onMerge, onDistinct, onSkip, onUndo}: Props) {
  const [keeperId, setKeeperId] = useState(pair.kept_article_id);
  const resolved = pair.verdict != null;
  const differing = differingFields(pair);

  const keeper = keeperId === pair.removed.article_id ? pair.removed : pair.kept;
  const other = keeper === pair.kept ? pair.removed : pair.kept;
  const setAside = !resolved && keeper.screening_decisions < other.screening_decisions;
  const blocked = other.has_review_work;

  const mergeButton = (
    <Button disabled={busy || blocked} onClick={() => onMerge(other.article_id, keeper.article_id)}>
      {t('duplicates', 'merge')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        value={keeperId}
        onValueChange={setKeeperId}
        disabled={resolved}
        className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2"
      >
        {[pair.kept, pair.removed].map((side, index) => {
          const isKeeper = side.article_id === keeperId;
          return (
            <div key={side.article_id} className="min-w-0 bg-card p-3">
              {!resolved && (
                <label
                  className={cn(
                    'mb-2 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[13px]',
                    isKeeper && 'bg-success/10 text-success ring-1 ring-success',
                  )}
                >
                  <RadioGroupItem
                    value={side.article_id}
                    aria-label={t('duplicates', 'keepSide')
                      .replace('{{n}}', String(index + 1))
                      .replace('{{title}}', side.title)}
                  />
                  {t('duplicates', 'keep')}
                </label>
              )}
              <dl className="flex flex-col gap-2">
                {COMPARE_FIELDS.map((field) => (
                  <div key={field}>
                    <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                      {t('duplicates', FIELD_LABEL[field])}
                      {differing.has(field) && (
                        <span
                          role="img"
                          aria-label={t('duplicates', 'differs')}
                          className="size-1.5 rounded-full bg-warning"
                        />
                      )}
                    </dt>
                    <dd className="min-w-0 break-words text-[13px] text-foreground">{fieldValue(side, field)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </RadioGroup>

      {setAside && (
        <p className="text-[13px] text-warning">
          {t('duplicates', 'setAsideWarning')
            .replace('{{removed}}', truncate(other.title))
            .replace('{{n}}', String(other.screening_decisions))
            .replace('{{kept}}', truncate(keeper.title))}
        </p>
      )}

      {resolved ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">
            {t('duplicates', pair.verdict === 'duplicate' ? 'resolvedMerged' : 'resolvedDistinct')
              .replace('{{name}}', pair.decided_by_name ?? '')
              .replace('{{date}}', pair.created_at ? new Date(pair.created_at).toLocaleDateString('en-US') : '')}
          </p>
          <Button variant="outline" disabled={busy} onClick={onUndo}>
            {t('duplicates', 'undo')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {blocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{mergeButton}</span>
              </TooltipTrigger>
              <TooltipContent>{t('duplicates', 'errHasReviewWork')}</TooltipContent>
            </Tooltip>
          ) : (
            mergeButton
          )}
          <Button variant="outline" disabled={busy} onClick={onDistinct}>
            {t('duplicates', 'notDuplicates')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            {t('duplicates', 'skip')}
          </Button>
        </div>
      )}
    </div>
  );
}
