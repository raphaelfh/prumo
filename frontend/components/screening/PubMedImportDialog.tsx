/**
 * Import records from PubMed into the project: a CSV export or pasted PMIDs,
 * checked locally, counted by a dry run, then imported. The started run is
 * tracked per project (`usePubmedImportRuns`); the project view's tracker
 * reloads the articles when it ends, and reopening this dialog shows it. Any
 * project member may import; whether the new articles then need a manager to
 * enroll them is the last line of the result.
 */
import {Loader2} from 'lucide-react';
import {useId, useState, type ChangeEvent, type DragEvent} from 'react';

import {AppDialog} from '@/components/patterns/AppDialog';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Textarea} from '@/components/ui/textarea';
import {
  usePubmedDryRun,
  useImportRun,
  useStartPubmedImport,
  useTrackedImportRunId,
} from '@/hooks/screening/usePubmedImport';
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import {screeningErrorMessage} from '@/lib/screening/errors';
import {parsePmidCsv, parsePmidText, type PmidParseResult} from '@/lib/screening/pmidInput';
import type {ImportRunRead} from '@/services/screeningService';
import {usePubmedImportRuns} from '@/stores/pubmedImportRuns';

type InputTab = 'csv' | 'paste';

interface PubMedImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  canManage: boolean;
}

function inputErrorMessage(result: Extract<PmidParseResult, {ok: false}>): string {
  switch (result.error) {
    case 'empty':
      return t('screening', 'errEmpty');
    case 'no_pmid_column':
      return t('screening', 'errNoPmidColumn');
    case 'invalid':
      return t('screening', 'errInvalidPmids').replace('{{list}}', (result.invalid ?? []).join(', '));
    case 'too_many':
      return t('screening', 'errTooMany');
    case 'file_too_large':
      return t('screening', 'errFileTooLarge');
  }
}

/** The server's 422 carries no offender list, so it gets its own, placeholder-free sentence. */
function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
    return t('screening', 'errPmidsRejected');
  }
  return screeningErrorMessage(error);
}

function fill(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    template,
  );
}

function Problem({children}: {children: string}) {
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {children}
    </p>
  );
}

function CsvPane({
  fileName,
  problem,
  onFile,
}: {
  fileName: string | null;
  problem: string | null;
  onFile: (file: File | null) => void;
}) {
  const inputId = useId();
  const onChange = (event: ChangeEvent<HTMLInputElement>) => onFile(event.target.files?.[0] ?? null);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onFile(event.dataTransfer.files[0] ?? null);
  };
  return (
    // The wrapper only receives the drop; the label and its input stay the keyboard path.
    <div role="presentation" className="flex flex-col gap-2" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <label
        htmlFor={inputId}
        // `relative`: the sr-only input inside is absolutely positioned; without
        // a positioned ancestor it adds phantom page scroll.
        className="relative flex min-h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
      >
        {t('screening', 'importDropHint')}
        {fileName && <span className="max-w-full truncate text-foreground">{fileName}</span>}
        <input id={inputId} type="file" accept=".csv,text/csv" className="sr-only" onChange={onChange} />
      </label>
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}

function DryRunCounts({counts}: {counts: {received: number; already_in_project: number; new: number; duplicate_in_request: number}}) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2 text-[13px] text-foreground">
      <p>{fill(t('screening', 'dryRunReceived'), {n: counts.received})}</p>
      <p>{fill(t('screening', 'dryRunAlready'), {n: counts.already_in_project})}</p>
      <p>{fill(t('screening', 'dryRunNew'), {n: counts.new})}</p>
      {counts.new > 0 && <p className="text-muted-foreground">{t('screening', 'dryRunNewByDoi')}</p>}
      {counts.duplicate_in_request > 0 && (
        <p>{fill(t('screening', 'dryRunRepeated'), {n: counts.duplicate_in_request})}</p>
      )}
      {counts.new === 0 && <p className="text-muted-foreground">{t('screening', 'dryRunNothingNew')}</p>}
    </div>
  );
}

const FAILED_KEY = {
  NCBI_UNAVAILABLE: 'importFailedNcbi',
  IMPORT_STALE: 'importFailedStale',
  IMPORT_TIME_LIMIT: 'importFailedTimeLimit',
} as const satisfies Record<NonNullable<ImportRunRead['error_code']>, string>;

function RunProgress({run, error, canManage, total}: {
  run: ImportRunRead | undefined;
  error: unknown;
  canManage: boolean;
  total: number;
}) {
  if (error) {
    const gone = error instanceof ApiError && error.status === 404;
    return <Problem>{gone ? t('screening', 'importRunNotFound') : screeningErrorMessage(error)}</Problem>;
  }
  if (run?.status === 'failed') {
    return <Problem>{t('screening', run.error_code ? FAILED_KEY[run.error_code] : 'importFailed')}</Problem>;
  }
  if (run?.status === 'completed') {
    return (
      <div role="status" className="flex flex-col gap-1 text-[13px]">
        <p className="font-medium text-foreground">
          {fill(t('screening', 'importDone'), {inserted: run.persisted, updated: run.updated})}
        </p>
        {run.unchanged > 0 && (
          <p className="text-muted-foreground">{fill(t('screening', 'importUnchanged'), {n: run.unchanged})}</p>
        )}
        {run.not_found > 0 && (
          <p className="text-muted-foreground">{fill(t('screening', 'importNotFound'), {n: run.not_found})}</p>
        )}
        {run.fetch_failed > 0 && (
          <p className="text-muted-foreground">{fill(t('screening', 'importFetchFailed'), {n: run.fetch_failed})}</p>
        )}
        <p className="text-muted-foreground">
          {t('screening', canManage ? 'importNextStepManager' : 'importNextStepMember')}
        </p>
      </div>
    );
  }
  const done = run ? run.persisted + run.updated + run.unchanged + run.skipped + run.failed : 0;
  return (
    <p role="status" className="flex items-center gap-2 text-[13px] text-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      {fill(t('screening', 'importRunning'), {done, total: run?.total_received ?? total})}
    </p>
  );
}

export function PubMedImportDialog({
  open,
  onOpenChange,
  projectId,
  canManage,
}: PubMedImportDialogProps) {
  const [tab, setTab] = useState<InputTab>('csv');
  const [text, setText] = useState('');
  const [csv, setCsv] = useState<{name: string; result: PmidParseResult} | null>(null);

  const dryRun = usePubmedDryRun(projectId);
  const start = useStartPubmedImport(projectId);
  const runId = useTrackedImportRunId(projectId);
  const clearRun = usePubmedImportRuns((state) => state.clear);
  const run = useImportRun(projectId, runId);

  const parsed: PmidParseResult | null =
    tab === 'paste' ? (text === '' ? null : parsePmidText(text)) : (csv?.result ?? null);
  const problem = parsed && !parsed.ok ? inputErrorMessage(parsed) : null;

  // Any edit to the list makes the counts and a failed start stale.
  const discardCheck = () => {
    dryRun.reset();
    start.reset();
  };
  const changeTab = (next: string) => {
    setTab(next === 'paste' ? 'paste' : 'csv');
    discardCheck();
  };
  const changeText = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    discardCheck();
  };
  const chooseFile = async (file: File | null) => {
    discardCheck();
    setCsv(file ? {name: file.name, result: await parsePmidCsv(file)} : null);
  };

  const status = run.data?.status;
  const inFlight = runId !== null && !run.isError && status !== 'completed' && status !== 'failed';
  const changeOpen = (next: boolean) => {
    // A run in flight keeps polling in the background; reopening shows it.
    if (!next && !inFlight) {
      setTab('csv');
      setText('');
      setCsv(null);
      discardCheck();
      clearRun(projectId);
    }
    onOpenChange(next);
  };

  const showRun = start.isPending || runId !== null;
  const counts = dryRun.data;
  const checkedPmids = dryRun.variables;

  let confirmLabel = t('screening', 'importCheck');
  let confirm: (() => void) | undefined = () => {
    if (parsed?.ok) dryRun.mutate(parsed.pmids);
  };
  let confirmDisabled = !parsed?.ok;
  if (counts && checkedPmids) {
    confirmLabel = fill(t('screening', 'importConfirm'), {n: counts.distinct});
    confirm = () => start.mutate(checkedPmids);
    confirmDisabled = false;
  } else if (dryRun.isPending) {
    confirmLabel = t('screening', 'importChecking');
  }
  if (showRun) confirm = undefined;

  const submitError = dryRun.isError ? dryRun.error : start.isError ? start.error : null;

  return (
    <AppDialog
      open={open}
      onOpenChange={changeOpen}
      title={t('screening', 'importTitle')}
      description={t('screening', 'importDescription')}
      confirmLabel={confirmLabel}
      onConfirm={confirm}
      confirmDisabled={confirmDisabled}
      isLoading={dryRun.isPending || start.isPending}
      cancelLabel={showRun ? t('screening', 'importClose') : undefined}
    >
      {showRun ? (
        <RunProgress run={run.data} error={run.error} canManage={canManage} total={counts?.distinct ?? 0} />
      ) : (
        <div className="flex flex-col gap-3">
          <Tabs value={tab} onValueChange={changeTab}>
            <TabsList>
              <TabsTrigger value="csv">{t('screening', 'importTabCsv')}</TabsTrigger>
              <TabsTrigger value="paste">{t('screening', 'importTabPaste')}</TabsTrigger>
            </TabsList>
            <TabsContent value="csv">
              <CsvPane fileName={csv?.name ?? null} problem={problem} onFile={(file) => void chooseFile(file)} />
            </TabsContent>
            <TabsContent value="paste" className="flex flex-col gap-2">
              <Textarea
                aria-label={t('screening', 'importTabPaste')}
                placeholder={t('screening', 'importPastePlaceholder')}
                value={text}
                onChange={changeText}
                rows={6}
                className="font-mono"
              />
              {problem && <Problem>{problem}</Problem>}
            </TabsContent>
          </Tabs>
          {counts && <DryRunCounts counts={counts} />}
          {submitError && <Problem>{importErrorMessage(submitError)}</Problem>}
        </div>
      )}
    </AppDialog>
  );
}
