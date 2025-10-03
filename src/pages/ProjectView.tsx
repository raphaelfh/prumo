import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FileText, ClipboardCheck, BarChart3, Settings, Plus } from "lucide-react";
import { toast } from "sonner";
import { AddArticleDialog } from "@/components/articles/AddArticleDialog";
import { ArticlesList } from "@/components/articles/ArticlesList";
import { ArticleEditDialog } from "@/components/articles/ArticleEditDialog";
import { ProjectSettings } from "@/components/project/ProjectSettings";
import { AssessmentInterface } from "@/components/assessment/AssessmentInterface";

interface Project {
  id: string;
  name: string;
  description: string | null;
  review_title: string | null;
  condition_studied: string | null;
}

interface Article {
  id: string;
  title: string;
  abstract: string | null;
  publication_year: number | null;
  journal_title: string | null;
  authors: string[] | null;
  doi: string | null;
  pmid: string | null;
  keywords: string[] | null;
}

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      loadProject();
      loadArticles();
    }
  }, [projectId]);

  const loadProject = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;
      setProject(data);
    } catch (error: any) {
      toast.error("Erro ao carregar projeto");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadArticles = async () => {
    try {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      console.error(error);
    }
  };


  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando projeto...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Projeto não encontrado</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{project.name}</h1>
              <p className="text-sm text-muted-foreground">
                {project.review_title || project.description || "Projeto de revisão sistemática"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="articles" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="articles">
              <FileText className="mr-2 h-4 w-4" />
              Artigos
            </TabsTrigger>
            <TabsTrigger value="extraction">
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Extração
            </TabsTrigger>
            <TabsTrigger value="assessment">
              <BarChart3 className="mr-2 h-4 w-4" />
              Avaliação
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="mr-2 h-4 w-4" />
              Configurações
            </TabsTrigger>
          </TabsList>

          <TabsContent value="articles" className="mt-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-semibold">Artigos</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Gerencie os artigos da sua revisão sistemática
                </p>
              </div>
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar Artigo
              </Button>
            </div>

            <ArticlesList 
              articles={articles} 
              onArticleClick={setSelectedArticleId}
              projectId={projectId!}
              onArticlesChange={loadArticles}
            />
          </TabsContent>

          <TabsContent value="extraction" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Extração de Dados</CardTitle>
                <CardDescription>
                  Extraia dados estruturados dos artigos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="py-12 text-center">
                  <ClipboardCheck className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="mb-2 text-lg font-medium">Em desenvolvimento</h3>
                  <p className="text-sm text-muted-foreground">
                    Funcionalidade de extração em breve
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assessment" className="mt-6">
            <AssessmentInterface projectId={projectId!} />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <ProjectSettings projectId={projectId!} />
          </TabsContent>
        </Tabs>
      </main>

      <AddArticleDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        projectId={projectId!}
        onArticleAdded={loadArticles}
      />

      <ArticleEditDialog
        open={!!selectedArticleId}
        onOpenChange={(open) => !open && setSelectedArticleId(null)}
        articleId={selectedArticleId}
        onArticleUpdated={loadArticles}
      />
    </div>
  );
}
