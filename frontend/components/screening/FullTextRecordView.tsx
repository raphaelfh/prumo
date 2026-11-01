/**
 * One full-text record (spec §7.3): the report beside its decision.
 *
 * Docked, and always below `lg`: a header, an `Abstract | PDF` strip (PDF by
 * default when the row has a main file), the chosen view, and the decision
 * pane underneath. Maximized on desktop: a nested `RunSplitShell` with the
 * decision pane and the abstract left and the PDF right; the screening shell
 * owns `⇧⌘\` and Escape, so the nested one registers neither.
 *
 * The PDF pane is always open and shows the PDF or the missing-PDF body
 * (with attach), so a PDF attached while maximized appears with no toggle.
 * Every hook runs unconditionally, above the layout branches; the viewer
 * store and the chosen view reset when the article changes.
 */
import {useState, type ReactNode} from 'react';

import {ArticleDocumentsBody} from '@/components/articles/ArticleDocumentsBody';
import {ArticleViewButton} from '@/components/articles/ArticleViewButton';
import {RunPdfContent} from '@/components/runs/RunPdfContent';
import {RunSplitShell} from '@/components/runs/RunSplitShell';
import {useIsBelowDesktop, useIsNarrow} from '@/hooks/use-mobile';
import {usePdfPanel} from '@/hooks/usePdfPanel';
import {t} from '@/lib/copy';
import {createViewerStore} from '@/pdf-viewer/core';
import type {ScreeningAssignmentRead, ScreeningRecordRow} from '@/services/screeningService';

import {RecordStatusChip} from './RecordStatusChip';
import {RecordAbstract} from './ScreeningParts';

type View = 'abstract' | 'pdf';

export interface FullTextRecordViewProps {
  projectId: string;
  row: ScreeningRecordRow;
  /** The article for the Abstract view. */
  read: ScreeningAssignmentRead;
  /** The workspace's controlled shell state. */
  maximized: boolean;
  /** `isReadOnly(config)`: no attach. */
  readOnly: boolean;
  /** `FullTextDecisionPane`, the ruling form, or the read-only details. */
  decisionPane: ReactNode;
}

export function FullTextRecordView({projectId, row, read, maximized, readOnly, decisionPane}: FullTextRecordViewProps) {
  const belowDesktop = useIsBelowDesktop();
  const pdf = usePdfPanel({initialOpen: true, compact: useIsNarrow()});
  const [store, setStore] = useState(() => createViewerStore());
  const [chosen, setChosen] = useState<View | null>(null);
  const [shownArticleId, setShownArticleId] = useState(row.article_id);
  if (shownArticleId !== row.article_id) {
    setShownArticleId(row.article_id);
    setStore(createViewerStore());
    setChosen(null);
  }
  const view: View = chosen ?? (row.has_pdf ? 'pdf' : 'abstract');

  const header = (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <RecordStatusChip status={row.status} arbitrated={row.outcome_kind === 'arbitrated'} />
      </div>
      <h2 className="text-base font-semibold leading-snug text-foreground">{read.article.title}</h2>
    </div>
  );
  const documents = (
    <ArticleDocumentsBody projectId={projectId} articleId={row.article_id} canAttach={!readOnly} mainOnly>
      {() => <RunPdfContent articleId={row.article_id} projectId={projectId} store={store} />}
    </ArticleDocumentsBody>
  );

  if (maximized && !belowDesktop) {
    return (
      <RunSplitShell
        nested
        pdfState={pdf}
        viewerStore={store}
        formPanel={
          <div className="flex flex-col gap-4 px-4 py-4">
            {header}
            {decisionPane}
            <section className="flex flex-col gap-2 border-t border-border/40 pt-3">
              <RecordAbstract article={read.article} />
            </section>
          </div>
        }
        pdfPanel={documents}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/40 px-4 pb-2 pt-3">
        {header}
        <div className="flex items-center gap-1">
          <ArticleViewButton
            active={view === 'abstract'}
            onClick={() => setChosen('abstract')}
            label={t('screening', 'viewAbstract')}
          />
          <ArticleViewButton active={view === 'pdf'} onClick={() => setChosen('pdf')} label={t('screening', 'viewPdf')} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'pdf' ? (
          documents
        ) : (
          <div className="flex h-full flex-col gap-2 overflow-y-auto px-4 py-3">
            <RecordAbstract article={read.article} />
          </div>
        )}
      </div>
      <div className="max-h-[50%] shrink-0 overflow-y-auto border-t border-border/40 bg-background px-4 py-3">
        {decisionPane}
      </div>
    </div>
  );
}
