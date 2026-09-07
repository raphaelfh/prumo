import {useState, type ReactNode} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/contexts/AuthContext";
import {createProject} from "@/services/projectsService";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import {BookOpen, Plus, Search} from "lucide-react";
import {toast} from "sonner";
import {AddProjectDialog} from "@/components/project/AddProjectDialog";
import {ProjectRow} from "@/components/project/ProjectRow";
import {ErrorState} from "@/components/patterns/ErrorState";
import {ApiError} from "@/integrations/api/client";
import {EmptyListState, ListDisplaySortPopover, ListToolbarSearch} from "@/components/shared/list";
import {projectsListKey, useProjectsQuery} from "@/hooks/useProjectsQuery";
import {useArchiveProject} from "@/hooks/useArchiveProject";
import type {ProjectListItem} from "@/types/project";
import {t} from '@/lib/copy';
import {cn} from "@/lib/utils";

type StatusFilter = 'active' | 'archived';
type SortField = 'name' | 'created_at' | 'updated_at';
type SortDirection = 'asc' | 'desc';

/** Page gutter, per frontend-ux §6. Never wider. */
const GUTTER = "px-4 lg:px-6";

function matchesSearch(project: ProjectListItem, term: string): boolean {
  if (term === '') return true;
  const haystack = `${project.name} ${project.description ?? ''} ${project.review_title ?? ''}`;
  return haystack.toLowerCase().includes(term);
}

function compare(a: ProjectListItem, b: ProjectListItem, field: SortField): number {
  if (field === 'name') return a.name.localeCompare(b.name);
  return Date.parse(a[field]) - Date.parse(b[field]);
}

export default function Dashboard() {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<StatusFilter>('active');
  const [sortField, setSortField] = useState<SortField>('updated_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const {data: projects = [], isLoading, isError, refetch} = useProjectsQuery();
  const archive = useArchiveProject();

  const term = searchTerm.trim().toLowerCase();
  const inStatus = projects.filter((p) => (status === 'active' ? p.is_active : !p.is_active));
  const visible = inStatus
    .filter((p) => matchesSearch(p, term))
    .slice()
    .sort((a, b) => (sortDirection === 'asc' ? compare(a, b, sortField) : -compare(a, b, sortField)));

  const handleArchivedChange = (projectId: string, archived: boolean) => {
    archive.mutate(
      {projectId, archived},
      {
        onSuccess: () => toast.success(t('pages', archived ? 'dashboardArchived' : 'dashboardRestored')),
        // 403 is the one failure the caller can act on: the route is
        // manager-gated (`require_project_manager`, Task 9) and a non-manager
        // can still be holding a stale affordance. `normalizeError` passes
        // Error instances through unchanged, so the ApiError apiClient threw
        // survives `toResult` and the mutation's rethrow with its `.status`
        // intact. Same idiom as `HITLExportDialog.tsx:116`.
        onError: (error) =>
          toast.error(
            error instanceof ApiError && error.status === 403
              ? t('pages', 'dashboardArchiveDenied')
              : error.message || t('pages', 'dashboardArchiveFailed'),
          ),
      },
    );
  };

  const handleCreateProject = async (data: { name: string; description?: string }) => {
    if (!user?.id) {
      toast.error(t('pages', 'dashboardAuthRequired'));
      return;
    }
    setCreating(true);
    const result = await createProject(data.name, data.description);
    setCreating(false);
    if (!result.ok) {
      toast.error(`${t('pages', 'dashboardErrorCreating')}: ${result.error.message}`);
      return;
    }
    toast.success(t('pages', 'dashboardProjectCreated'));
    await queryClient.invalidateQueries({queryKey: projectsListKey(user.id)});
    setAddDialogOpen(false);
  };

  const statusTab = (value: StatusFilter, label: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={status === value}
      onClick={() => setStatus(value)}
      className={cn(
        'h-7 shrink-0 rounded px-3 text-[13px] font-medium transition-colors duration-75 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        status === value ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  // ONE control bar. Below the compact breakpoint it wraps to a second line
  // rather than duplicating the tablist — two `role="tab"` sets with the same
  // names would be two entries in the a11y tree, and ambiguous to query.
  const header = (
    <div className={cn("@container/hubbar sticky top-0 z-10 shrink-0 border-b border-border/40 bg-background/80 backdrop-blur-md", GUTTER)}>
      <div className="flex min-h-12 flex-wrap items-center gap-2 py-1.5 @[34rem]/hubbar:flex-nowrap @[34rem]/hubbar:py-0">
        <ListToolbarSearch
          placeholder={t('pages', 'dashboardSearchPlaceholder')}
          value={searchTerm}
          onChange={setSearchTerm}
        />
        <div
          role="tablist"
          aria-label={t('pages', 'dashboardFilterStatusAria')}
          className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/40 p-0.5"
        >
          {statusTab('active', t('pages', 'dashboardFilterActive'))}
          {statusTab('archived', t('pages', 'dashboardFilterArchived'))}
        </div>
        <ListDisplaySortPopover
          sortOptions={[
            {value: 'name', label: t('pages', 'dashboardSortName')},
            {value: 'created_at', label: t('pages', 'dashboardCreatedDate')},
            {value: 'updated_at', label: t('pages', 'dashboardSortUpdated')},
          ]}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortFieldChange={(v) => setSortField(v as SortField)}
          onSortDirectionChange={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
          orderLabel={t('pages', 'dashboardSortOrdering')}
          tooltipLabel={t('pages', 'dashboardSortTooltip')}
          ariaLabel={t('pages', 'dashboardSortAria')}
        />
        <Button
          variant="default"
          size="sm"
          onClick={() => setAddDialogOpen(true)}
          disabled={creating}
          className="shrink-0 gap-1.5 rounded-md text-[12px] font-medium shadow-xs transition-all motion-reduce:transition-none"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true"/>
          {/* Folds to sr-only, never to `hidden`: `hidden` would strip the word
              from the button's accessible name (.claude/rules/frontend.md). */}
          <span className="sr-only @[34rem]/hubbar:not-sr-only">{t('pages', 'dashboardNewProject')}</span>
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <>
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-border/30">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={cn("flex items-center gap-3 py-3", GUTTER)}>
                <Skeleton className="h-9 w-9 shrink-0 rounded-lg"/>
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3 max-w-[180px]"/>
                  <Skeleton className="h-3 w-1/2 max-w-[280px]"/>
                </div>
                <Skeleton className="hidden h-7 w-16 shrink-0 rounded md:block"/>
                <Skeleton className="h-8 w-8 shrink-0 rounded-md"/>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (isError) {
    return (
      <>
        {header}
        <div className={cn("min-h-0 flex-1 overflow-y-auto py-6", GUTTER)}>
          <ErrorState message={t('pages', 'dashboardCouldNotLoadProjects')} onRetry={refetch}/>
        </div>
      </>
    );
  }

  // Three distinct empty states, not one (spec §5).
  let body: ReactNode;
  if (projects.length === 0) {
    body = (
      <div className={cn("flex flex-col items-center justify-center py-16 sm:py-20 lg:py-28", GUTTER)}>
        <div className="w-full max-w-sm text-center duration-500 animate-in fade-in slide-in-from-bottom-4 motion-reduce:animate-none">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
            <BookOpen className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5}/>
          </div>
          <h3 className="mb-2 text-base font-medium text-foreground">
            {t('pages', 'dashboardStartFirstProject')}
          </h3>
          <p className="mx-auto mb-8 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {t('pages', 'dashboardStartFirstProjectDesc')}
          </p>
          <Button
            onClick={() => setAddDialogOpen(true)}
            className="rounded-md px-6 text-xs font-medium shadow-xs transition-all motion-reduce:transition-none"
          >
            <Plus className="mr-2 h-3.5 w-3.5"/>
            {t('pages', 'dashboardCreateProject')}
          </Button>
        </div>
      </div>
    );
  } else if (visible.length === 0 && term !== '') {
    body = (
      <div className={cn("py-6", GUTTER)}>
        <EmptyListState
          icon={Search}
          title={t('pages', 'dashboardNoMatches')}
          description={t('pages', 'dashboardNoMatchesDesc')}
          actionLabel={t('pages', 'dashboardClearSearch')}
          onAction={() => setSearchTerm('')}
        />
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className={cn("py-6", GUTTER)}>
        <EmptyListState
          icon={BookOpen}
          title={t('pages', 'dashboardNoArchived')}
          description={t('pages', 'dashboardNoArchivedDesc')}
        />
      </div>
    );
  } else {
    body = (
      <div className="divide-y divide-border/30">
        {visible.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            userId={user?.id ?? ''}
            onArchivedChange={handleArchivedChange}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      <AddProjectDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onProjectCreate={handleCreateProject}
        isCreating={creating}
      />
    </>
  );
}
