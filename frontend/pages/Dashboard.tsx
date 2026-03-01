import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {supabase} from "@/integrations/supabase/client";
import {useAuth} from "@/contexts/AuthContext";
import {AppLayout} from "@/components/layout/AppLayout";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Skeleton} from "@/components/ui/skeleton";
import {BookOpen, Plus} from "lucide-react";
import {toast} from "sonner";
import {AddProjectDialog} from "@/components/project/AddProjectDialog";
import {PageHeader} from "@/components/patterns/PageHeader";
import {EmptyState} from "@/components/patterns/EmptyState";
import {ErrorState} from "@/components/patterns/ErrorState";

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  is_active: boolean;
  review_title: string | null;
}

export default function Dashboard() {
  const {user} = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const {data: projects = [], isLoading, isError, refetch} = useQuery({
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
      toast.error("Você precisa estar autenticado para criar um projeto");
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
        toast.error(`Erro ao criar projeto: ${rpcError.message}`);
        return;
      }

      if (!projectId) {
        toast.error("Erro: ID do projeto não foi retornado");
        return;
      }

      toast.success("Projeto criado com sucesso!");
      await queryClient.invalidateQueries({queryKey: ['projects']});
      setAddDialogOpen(false);
    } catch (_err) {
      toast.error("Erro inesperado ao criar projeto");
    } finally {
      setCreating(false);
    }
  };

  const header = (
      <PageHeader
          title="Meus Projetos"
          description="Gerencie suas revisões sistemáticas"
          actions={
            <Button onClick={() => setAddDialogOpen(true)} disabled={creating}>
              <Plus className="mr-2 h-4 w-4"/>
              Novo Projeto
            </Button>
          }
      />
  );

  if (isLoading) {
    return (
      <AppLayout>
        {header}
        <div className="p-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-3/4"/>
                    <Skeleton className="h-4 w-full mt-2"/>
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-3 w-1/3"/>
                  </CardContent>
                </Card>
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
          <ErrorState
              message="Não foi possível carregar os projetos."
              onRetry={refetch}
          />
        </AppLayout>
    );
  }

  return (
      <AppLayout>
        {header}
        <div className="p-6">
        {projects.length === 0 ? (
            <EmptyState
                icon={<BookOpen className="h-12 w-12"/>}
                title="Nenhum projeto ainda"
                description="Crie seu primeiro projeto de revisão sistemática"
                action={{
                  label: "Criar Primeiro Projeto",
                  onClick: () => setAddDialogOpen(true),
                }}
            />
        ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
                <Card
                    key={project.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none"
                onClick={() => navigate(`/projects/${project.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigate(`/projects/${project.id}`);
                    }}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{project.name}</CardTitle>
                    {project.is_active && (
                        <Badge className="shrink-0 bg-success/15 text-success border-transparent">
                        Ativo
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="line-clamp-2">
                    {project.description || project.review_title || "Sem descrição"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Criado em {new Date(project.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </CardContent>
              </Card>
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
