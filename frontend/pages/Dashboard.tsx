import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {supabase} from "@/integrations/supabase/client";
import {useAuth} from "@/contexts/AuthContext";
import {AppLayout} from "@/components/layout/AppLayout";
import {Button} from "@/components/ui/button";
import {Skeleton} from "@/components/ui/skeleton";
import {BookOpen, ChevronRight, Plus} from "lucide-react";
import {toast} from "sonner";
import {AddProjectDialog} from "@/components/project/AddProjectDialog";
import {ErrorState} from "@/components/patterns/ErrorState";
import type {ProjectListItem} from "@/types/project";
import {t} from '@/lib/copy';

export default function Dashboard() {
  const {user} = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

    const {data: projects = [], isLoading, isError, refetch} = useQuery<ProjectListItem[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const {data, error} = await supabase
        .from("projects")
        .select("id, name, description, created_at, is_active, review_title")
          .order("created_at", {ascending: false});
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const handleCreateProject = async (data: { name: string; description?: string }) => {
    if (!user?.id) {
        toast.error(t('pages', 'dashboardAuthRequired'));
      return;
    }

    setCreating(true);

    try {
      const {data: projectId, error: rpcError} = await supabase.rpc(
        'create_project_with_member',
        {
          p_name: data.name,
          p_description: data.description || undefined,
          p_review_title: undefined,
        }
      );

      if (rpcError) {
        console.error("Error creating project via RPC:", rpcError);
          toast.error(`${t('pages', 'dashboardErrorCreating')}: ${rpcError.message}`);
        return;
      }

      if (!projectId) {
          toast.error(t('pages', 'dashboardErrorProjectIdNotReturned'));
        return;
      }

        toast.success(t('pages', 'dashboardProjectCreated'));
      await queryClient.invalidateQueries({queryKey: ['projects']});
      setAddDialogOpen(false);
    } catch (_err) {
        toast.error(t('pages', 'dashboardUnexpectedError'));
    } finally {
      setCreating(false);
    }
  };

  const header = (
      <div
          className="flex items-center justify-between px-6 h-12 border-b border-border/40 sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
            <h1 className="text-[13px] font-semibold tracking-tight text-foreground uppercase tracking-[0.05em] opacity-80">{t('pages', 'dashboardMyProjects')}
            </h1>
        </div>
        <Button
            variant="default"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            disabled={creating}
            className="h-8 px-3 text-[12px] font-medium transition-all rounded-md shadow-sm"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5"/>
            {t('pages', 'dashboardNewProject')}
        </Button>
      </div>
  );

  if (isLoading) {
    return (
      <AppLayout>
        {header}
        <div className="px-6 py-2">
          <div className="space-y-0 divide-y divide-border/30">
            {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <Skeleton className="h-8 w-8 rounded-md"/>
                    <div className="flex-1">
                      <Skeleton className="h-4 w-1/4 mb-2"/>
                      <Skeleton className="h-3 w-1/2"/>
                    </div>
                  </div>
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
          <div className="px-6">
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
        <div className="flex-1 min-h-[calc(100vh-3.5rem)]">
        {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
              <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div
                    className="h-12 w-12 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-5 border border-border/50">
                  <BookOpen className="h-6 w-6 text-muted-foreground/40" strokeWidth={1.5}/>
                </div>
                  <h3 className="text-base font-medium text-foreground mb-2">{t('pages', 'dashboardStartFirstProject')}</h3>
                <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto leading-relaxed">
                    {t('pages', 'dashboardStartFirstProjectDesc')}
                </p>
                <Button
                    onClick={() => setAddDialogOpen(true)}
                    className="h-9 px-6 text-xs font-medium rounded-md transition-all shadow-sm"
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
                    className="group flex items-center justify-between py-3 px-6 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                onClick={() => navigate(`/projects/${project.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigate(`/projects/${project.id}`);
                    }}
              >
                  <div className="flex items-center gap-4 min-w-0">
                    <div
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 bg-muted/20 group-hover:border-border transition-all duration-200 group-hover:shadow-sm">
                      <BookOpen
                          className="h-4.5 w-4.5 text-muted-foreground/60 group-hover:text-foreground transition-colors"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-0.5">
                        <h3 className="text-[14px] font-medium text-foreground tracking-tight truncate group-hover:text-primary transition-colors">
                          {project.name}
                        </h3>
                        {project.is_active && (
                            <div
                                className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"/>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-[12px] text-muted-foreground/60 truncate max-w-[500px] font-normal leading-relaxed">
                            {project.description || project.review_title || t('pages', 'dashboardNoDescription')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-8">
                    <div className="hidden sm:flex flex-col items-end">
                      <span
                          className="text-[10px] text-muted-foreground/40 font-semibold uppercase tracking-wider mb-0.5">
                        {t('pages', 'dashboardCreatedDate')}
                      </span>
                      <span className="text-[12px] text-muted-foreground/80 font-medium">
                        {new Date(project.created_at).toLocaleDateString('en-US')}
                      </span>
                    </div>
                    <div
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/30 group-hover:text-foreground/80 group-hover:bg-muted/50 transition-all">
                      <ChevronRight className="h-4 w-4"/>
                    </div>
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
