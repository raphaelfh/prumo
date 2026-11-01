/**
 * Pieces every screening surface shares: the centered notice, the busy
 * region, the record body (the reading column) and the decision labels.
 */
import {useId, type ReactNode} from 'react';

import {Skeleton} from '@/components/ui/skeleton';
import {t} from '@/lib/copy';
import type {ScreeningAssignmentRead, ScreeningDecisionCreate} from '@/services/screeningService';

import {RecordChips, RecordIdentifiers, RecordTerms} from './RecordMeta';
import {StructuredAbstract} from './StructuredAbstract';

type ScreeningArticle = ScreeningAssignmentRead['article'];

export function Notice({title, body, children}: {title: string; body: string; children?: ReactNode}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <p className="max-w-sm text-[13px] text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}

export function LoadingState() {
  const labelId = useId();
  return (
    <section aria-busy="true" aria-labelledby={labelId} className="flex flex-col gap-2 p-2">
      <span id={labelId} className="sr-only">
        {t('screening', 'loading')}
      </span>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
    </section>
  );
}

const DECISION_LABEL = {
  include: 'decisionInclude',
  exclude: 'decisionExclude',
  maybe: 'decisionMaybe',
} as const;

export function decisionLabel(decision: ScreeningDecisionCreate['decision']): string {
  return t('screening', DECISION_LABEL[decision]);
}

/**
 * The record as read for screening, in a 68ch/15px column: chips, title,
 * byline, identifiers, the abstract (or its absence), then MeSH and keywords.
 */
export function RecordBody({article}: {article: ScreeningArticle}) {
  const byline = [article.authors?.join(', '), article.journal_title, article.publication_year]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join(' · ');
  return (
    <article className="flex w-full min-w-0 max-w-[68ch] flex-col gap-2 text-[15px]">
      <RecordChips article={article} />
      <h2 className="text-base font-semibold leading-snug text-foreground">{article.title}</h2>
      {byline && <p className="text-[13px] text-muted-foreground">{byline}</p>}
      <RecordIdentifiers article={article} />
      {article.abstract ? (
        <StructuredAbstract abstract={article.abstract} />
      ) : (
        <p className="italic text-muted-foreground">{t('screening', 'noAbstract')}</p>
      )}
      <RecordTerms article={article} />
    </article>
  );
}
