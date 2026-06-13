import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useAuth} from "@/contexts/AuthContext";
import {listProjectsForDashboard, createProject} from "@/services/projectsService";
import {AppLayout} from "@/components/layout/AppLayout";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import {BookOpen, ChevronRight, Plus} from "lucide-react";
import {toast} from "sonner";
import {AddProjectDialog} from "@/components/project/AddProjectDialog";
import {ErrorState} from "@/components/patterns/ErrorState";
import type {ProjectListItem} from "@/types/project";
import {t} from '@/lib/copy';
import {projectKeys} from '@/lib/query-keys';
import {cn} from "@/lib/utils";

const SHELL_PADDING_X = "px-4 sm:px-6 lg:px-8 2xl:px-12";

export default function Dashboard() {
  const {user} = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const {data: projects = [], isLoading, isError, refetch} = useQuery<ProjectListItem[]>({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const result = await listProjectsForDashboard();
      if (!result.ok) throw result.error;
      return result.data;
    },
    staleTime: 30_000,
  });

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
    await queryClient.invalidateQueries({queryKey: projectKeys.all});
    setAddDialogOpen(false);
  };

  const header = (
    <div className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className={cn("flex h-12 items-center justify-between gap-3", SHELL_PADDING_X)}>
        <h1 className="text-[13px] font-semibold uppercase tracking-[0.05em] text-foreground/80">
          {t('pages', 'dashboardMyProjects')}
        </h1>
        <Button
          variant="default"
          size="sm"
          onClick={() => setAddDialogOpen(true)}
          disabled={creating}
          className="h-8 gap-1.5 rounded-md px-2.5 text-[12px] font-medium shadow-sm transition-all sm:px-3 motion-reduce:transition-none"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true"/>
          {t('pages', 'dashboardNewProject')}
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <AppLayout>
        {header}
        <div>
          <div className="divide-y divide-border/30">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={cn("flex items-center gap-3 py-3 sm:gap-4", SHELL_PADDING_X)}>
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
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        {header}
        <div className={cn("py-6", SHELL_PADDING_X)}>
          <ErrorState
            message={t('pages', 'dashboardCouldNotLoadProjects')}
            onRetry={refetch}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {header}
      <div>
        {projects.length === 0 ? (
          <div className={cn("flex flex-col items-center justify-center py-16 sm:py-20 lg:py-28", SHELL_PADDING_X)}>
            <div
              className="w-full max-w-sm text-center duration-500 animate-in fade-in slide-in-from-bottom-4 motion-reduce:animate-none">
              <div
                className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/50 bg-muted/30">
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
                className="h-9 rounded-md px-6 text-xs font-medium shadow-sm transition-all motion-reduce:transition-none"
              >
                <Plus className="mr-2 h-3.5 w-3.5"/>
                {t('pages', 'dashboardCreateProject')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {projects.map((project) => (
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                aria-label={`${project.name}${project.is_active ? ' — active' : ''}`}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 py-3 outline-none sm:gap-4",
                  "transition-colors duration-75 motion-reduce:transition-none",
                  "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  SHELL_PADDING_X,
                )}
                onClick={() => navigate(`/projects/${project.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/projects/${project.id}`);
                  }
                }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/20 transition-all duration-150 group-hover:border-border group-hover:shadow-sm motion-reduce:transition-none">
                  <BookOpen
                    className="h-4 w-4 text-muted-foreground/60 transition-colors group-hover:text-foreground motion-reduce:transition-none"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-2">
                    <h3 className="truncate text-[14px] font-medium tracking-tight text-foreground transition-colors group-hover:text-primary motion-reduce:transition-none">
                      {project.name}
                    </h3>
                    {project.is_active && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-success shadow-[0_0_8px_hsl(var(--success)/0.45)]"
                      />
                    )}
                  </div>
                  <p className="truncate text-[12px] font-normal leading-relaxed text-muted-foreground/60">
                    {project.description || project.review_title || t('pages', 'dashboardNoDescription')}
                  </p>
                </div>

                <div className="hidden shrink-0 flex-col items-end pl-2 md:flex">
                  <span
                    className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                    {t('pages', 'dashboardCreatedDate')}
                  </span>
                  <span className="text-[12px] font-medium text-muted-foreground/80">
                    {new Date(project.created_at).toLocaleDateString('en-US')}
                  </span>
                </div>

                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/30 transition-all duration-150 group-hover:bg-muted/50 group-hover:text-foreground/80 motion-reduce:transition-none">
                  <ChevronRight className="h-4 w-4" aria-hidden="true"/>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddProjectDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onProjectCreate={handleCreateProject}
        isCreating={creating}
      />
    </AppLayout>
  );
}
