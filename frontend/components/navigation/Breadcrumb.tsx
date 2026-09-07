/**
 * Route-derived breadcrumb for the shell's top bar.
 *
 *   /               → Projects
 *   /settings       → Settings
 *   /projects/:id   → <project name> › <section>   (section keeps its info tooltip)
 *
 * This replaces three ad-hoc title treatments — the Topbar brand block, the
 * Topbar section title and the `/settings` PageHeader title — with one
 * (ledger 2026-09-07T14:50Z). Reads the URL, never ProjectContext: the bar now
 * renders above ProjectProvider.
 *
 * The root has FOUR states, not two. `project?.name` being `undefined` covers
 * a read still in flight, a read that FAILED, and an id the caller's list does
 * not contain — and collapsing them into one `aria-hidden` shimmer leaves this
 * landmark permanently empty to a screen reader whenever the list read fails,
 * with the hub's ErrorState not mounted on `/projects/:id` to say otherwise.
 * The switcher (`SidebarHeader`) owns the retry; this bar only has to name
 * what happened.
 */
import React from 'react';
import {ChevronRight, Info} from 'lucide-react';
import {useLocation} from 'react-router';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {TruncatedText} from '@/components/runs/header/TruncatedText';
import {useShellLocation} from '@/hooks/useShellLocation';
import {useProjectsQuery} from '@/hooks/useProjectsQuery';
import {tabIdToLabel} from '@/components/layout/sidebarConfig';
import {sectionDescriptionKey} from '@/components/layout/sectionViews';
import {t} from '@/lib/copy';

type BreadcrumbRoot = {kind: 'loading'} | {kind: 'text'; text: string};

export const AppBreadcrumb: React.FC = () => {
  const {projectId, activeSection} = useShellLocation();
  const location = useLocation();
  const {data: projects, isError} = useProjectsQuery();

  const project = projectId === null ? undefined : projects?.find((p) => p.id === projectId);
  const descriptionKey = activeSection === null ? undefined : sectionDescriptionKey[activeSection];

  // Order matters, and the "still loading" test is `projects === undefined`
  // rather than `isLoading`: that also covers the query disabled under an
  // empty identity, which `isLoading` reports as false.
  let root: BreadcrumbRoot;
  if (projectId === null) {
    root = {
      kind: 'text',
      text: location.pathname === '/settings' ? t('layout', 'settings') : t('layout', 'projects'),
    };
  } else if (project !== undefined) {
    root = {kind: 'text', text: project.name};
  } else if (isError) {
    root = {kind: 'text', text: t('navigation', 'breadcrumbProjectLoadFailed')};
  } else if (projects === undefined) {
    root = {kind: 'loading'};
  } else {
    // Resolved, and this id is not in the caller's list: a stale bookmark, a
    // revoked membership, an id the filtered list does not carry. Ordinary,
    // not a failure — it must not borrow the error string.
    root = {kind: 'text', text: t('navigation', 'breadcrumbProjectNotFound')};
  }

  return (
    <nav
      aria-label={t('navigation', 'breadcrumbAria')}
      className="flex min-w-0 items-center gap-1.5 px-2"
    >
      {root.kind === 'loading' ? (
        // Project route whose name has not resolved yet: the same skeleton the
        // Topbar already uses for its loading state, so the bar does not jump
        // — plus a name, because an aria-hidden shimmer is not a breadcrumb.
        <>
          <span className="h-[13px] w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
          <span className="sr-only">{t('layout', 'loadingProjects')}</span>
        </>
      ) : (
        <TruncatedText className="text-header-title font-medium text-foreground" text={root.text} />
      )}

      {projectId !== null && activeSection !== null && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          <TruncatedText
            className="text-header-title text-muted-foreground"
            text={tabIdToLabel[activeSection] ?? ''}
          />
          {descriptionKey !== undefined && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="hidden rounded text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 @[34rem]/headerbar:inline-flex"
                    aria-label={t('navigation', descriptionKey)}
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('navigation', descriptionKey)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </>
      )}
    </nav>
  );
};
