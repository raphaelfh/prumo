import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {useQuery, useQueryClient} from "@tanstack/react-query";
import {supabase} from "@/integrations/supabase/client";
import {useAuth} from "@/contexts/AuthContext";
import {AppLayout} from "@/components/layout/AppLayout";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {BarChart3, BookOpen, ClipboardCheck, FileText, Plus} from "lucide-react";
import {toast} from "sonner";
import {AddProjectDialog} from "@/components/project/AddProjectDialog";

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  is_active: boolean;
  review_title: string | null;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const {data: projects = [], isLoading: loading} = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, description, created_at, is_active, review_title")
        .order("created_at", { ascending: false });
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
      // Usar função RPC que cria projeto e adiciona criador como manager atomicamente
      const { data: projectId, error: rpcError } = await supabase.rpc(
        'create_project_with_member',
        {
          p_name: data.name,
          p_description: data.description || undefined,
          p_review_title: undefined
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

      console.log('✅ Projeto criado com sucesso:', projectId);

      toast.success("Projeto criado com sucesso!");

      await queryClient.invalidateQueries({queryKey: ['projects']});
      setAddDialogOpen(false);

    } catch (error: any) {
      console.error("Unexpected error:", error);
      toast.error("Erro inesperado ao criar projeto");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando projetos...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-secondary">
        <main className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Meus Projetos</h2>
            <p className="text-muted-foreground">Gerencie suas revisões sistemáticas</p>
          </div>
          <Button onClick={() => setAddDialogOpen(true)} disabled={creating}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Projeto
          </Button>
        </div>

        {projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BookOpen className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-medium">Nenhum projeto ainda</h3>
              <p className="mb-4 text-center text-sm text-muted-foreground">
                Crie seu primeiro projeto de revisão sistemática
              </p>
              <Button onClick={() => setAddDialogOpen(true)} disabled={creating}>
                <Plus className="mr-2 h-4 w-4" />
                Criar Primeiro Projeto
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Card 
                key={project.id} 
                className="cursor-pointer transition-all hover:shadow-md"
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    {project.is_active && (
                      <Badge variant="secondary" className="bg-success text-success-foreground">
                        Ativo
                      </Badge>
                    )}
                  </div>
                  <CardDescription>
                    {project.description || project.review_title || "Sem descrição"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <FileText className="h-4 w-4" />
                      <span>Artigos</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ClipboardCheck className="h-4 w-4" />
                      <span>Extração</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <BarChart3 className="h-4 w-4" />
                      <span>Avaliação</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        </main>

        {/* Diálogo de Adicionar Projeto */}
        <AddProjectDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          onProjectCreate={handleCreateProject}
          isCreating={creating}
        />
      </div>
    </AppLayout>
  );
}
