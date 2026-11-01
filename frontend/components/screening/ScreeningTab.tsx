/**
 * The project's Screening tab (spec §4, §4.6): the config read gates every
 * sub-view. While it is pending or errored the tab shows the loading / error
 * state and never touches the URL. Once it has succeeded:
 * - `?screeningTab=settings` without `can_manage` is redirected to
 *   `title_abstract` (replace, no toast);
 * - a manager with no `?screeningTab` and no config lands on Settings (first
 *   run, replace).
 * Title/abstract without a config shows the toolbar, then "not set up";
 * otherwise the workspace. `?assignment=` is stripped by the workspace.
 */
import {useEffect} from 'react';
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

/** The URL change the loaded config demands, or null. */
function requiredTab(config: ScreeningConfigRead, tab: string | null): string | null {
  if (tab === 'settings' && !config.can_manage) return 'title_abstract';
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
  if (config.reviewer_count === null) {
    return <NotSetUp projectId={projectId} config={config} onOpenSettings={() => setTab('settings')} />;
  }
  return <TitleAbstractWorkspace projectId={projectId} config={config} />;
}
