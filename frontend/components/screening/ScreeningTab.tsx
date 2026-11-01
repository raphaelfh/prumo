/**
 * The project's Screening tab (spec §4, §4.6): the config read gates every
 * sub-view. While it is pending or errored the tab shows the loading / error
 * state and never touches the URL. Once it has succeeded:
 * - `?screeningTab=settings` or `duplicates` without `can_manage` is
 *   redirected to `title_abstract` (replace, no toast);
 * - a manager with no `?screeningTab` and no config lands on Settings (first
 *   run, replace).
 * Title/abstract without a config shows the toolbar, then "not set up";
 * otherwise the workspace. `?assignment=` is stripped by the workspace.
 * Duplicates does not read the screening config, so it renders before the
 * not-set-up gate. Changing sub-view drops the selection and status filter
 * (`article`, `kept`, `status`): they belong to the view that wrote them.
 */
import {useEffect, useState} from 'react';
import {useSearchParams} from 'react-router';

import {ErrorState} from '@/components/patterns/ErrorState';
import {Button} from '@/components/ui/button';
import {useScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import {t} from '@/lib/copy';
import {isReadOnly} from '@/lib/screening/records';
import {screeningErrorMessage} from '@/lib/screening/errors';
import type {ScreeningConfigRead} from '@/services/screeningService';

import {LoadingState, Notice} from './ScreeningParts';
import {ScreeningSettings} from './ScreeningSettings';
import {PubMedImportButton} from './ScreeningToolbarActions';
import {TitleAbstractWorkspace} from './TitleAbstractWorkspace';

const TAB_PARAM = 'screeningTab';
const VIEW_PARAMS = ['article', 'kept', 'status'] as const;

/** The URL change the loaded config demands, or null. */
function requiredTab(config: ScreeningConfigRead, tab: string | null): string | null {
  if ((tab === 'settings' || tab === 'duplicates') && !config.can_manage) return 'title_abstract';
  if (tab === null && config.reviewer_count === null && config.can_manage) return 'settings';
  return null;
}

function NotSetUp({
  projectId,
  config,
  onOpenSettings,
}: {
  projectId: string;
  config: ScreeningConfigRead;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!isReadOnly(config) && (
          <PubMedImportButton projectId={projectId} canManage={config.can_manage} className="shrink-0" />
        )}
      </div>
      {config.can_manage ? (
        <Notice title={t('screening', 'notConfiguredManagerTitle')} body={t('screening', 'configureDescription')}>
          <Button size="sm" onClick={onOpenSettings}>
            {t('screening', 'openSettings')}
          </Button>
        </Notice>
      ) : (
        <Notice title={t('screening', 'notConfiguredTitle')} body={t('screening', 'notConfiguredMember')} />
      )}
    </div>
  );
}

export function ScreeningTab({projectId}: {projectId: string}) {
  const query = useScreeningConfig(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get(TAB_PARAM);
  const redirectTo = query.isSuccess ? requiredTab(query.data, tabParam) : null;

  const setTab = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(TAB_PARAM, value);
        return next;
      },
      {replace: true},
    );

  // Previous value in state: the render notes the tab change as a fresh
  // token, and the effect keyed on that token does the URL write.
  const [seenTab, setSeenTab] = useState(tabParam);
  const [tabChange, setTabChange] = useState<object | null>(null);
  if (seenTab !== tabParam) {
    setSeenTab(tabParam);
    setTabChange({});
  }
  useEffect(() => {
    if (tabChange === null) return;
    setSearchParams(
      (prev) => {
        if (!VIEW_PARAMS.some((name) => prev.has(name))) return prev;
        const next = new URLSearchParams(prev);
        VIEW_PARAMS.forEach((name) => next.delete(name));
        return next;
      },
      {replace: true},
    );
  }, [tabChange, setSearchParams]);

  useEffect(() => {
    if (redirectTo === null) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(TAB_PARAM, redirectTo);
        return next;
      },
      {replace: true},
    );
  }, [redirectTo, setSearchParams]);

  if (query.isPending) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState
        title={t('screening', 'loadErrorTitle')}
        message={screeningErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const config = query.data;
  const tab = redirectTo ?? tabParam;

  if (tab === 'settings' && config.can_manage) {
    return <ScreeningSettings projectId={projectId} config={config} />;
  }
  // Placeholder until the Duplicates workspace is wired in.
  if (tab === 'duplicates') return null;
  if (config.reviewer_count === null) {
    return <NotSetUp projectId={projectId} config={config} onOpenSettings={() => setTab('settings')} />;
  }
  return <TitleAbstractWorkspace projectId={projectId} config={config} />;
}
