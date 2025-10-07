import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Plus, FileText, ClipboardCheck, BarChart3 } from "lucide-react";
import { toast } from "sonner";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [user]);

  const loadProjects = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (error: any) {
      toast.error("Erro ao carregar projetos");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    // Validate authentication
    if (!user?.id) {
      toast.error("Você precisa estar autenticado para criar um projeto");
      return;
    }

    const name = prompt("Nome do projeto:");
    if (!name || name.trim() === "") return;

    setCreating(true);
    try {
      // Create project and add creator as manager in a transaction
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .insert({
          name: name.trim(),
          created_by_id: user.id
        })
        .select()
        .single();

      if (projectError) {
        console.error("Error creating project:", projectError);
        toast.error(`Erro ao criar projeto: ${projectError.message}`);
        return;
      }

      // Add creator as manager
      const { error: memberError } = await supabase
        .from("project_members")
        .insert({
          project_id: projectData.id,
          user_id: user.id,
          role: "manager",
          created_by_id: user.id
        });

      if (memberError) {
        console.error("Error adding project member:", memberError);
        toast.error(`Erro ao adicionar membro: ${memberError.message}`);
        return;
      }

      toast.success("Projeto criado com sucesso!");
      await loadProjects();
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
          <Button onClick={createProject} disabled={creating}>
            <Plus className="mr-2 h-4 w-4" />
            {creating ? "Criando..." : "Novo Projeto"}
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
              <Button onClick={createProject} disabled={creating}>
                <Plus className="mr-2 h-4 w-4" />
                {creating ? "Criando..." : "Criar Primeiro Projeto"}
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
      </div>
    </AppLayout>
  );
}
