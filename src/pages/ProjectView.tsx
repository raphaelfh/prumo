import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ArticlesList } from "@/components/articles/ArticlesList";
import { ProjectSettings } from "@/components/project/ProjectSettings";
import { AssessmentInterface } from "@/components/assessment/AssessmentInterface";
import { ExtractionInterface } from "@/components/extraction/ExtractionInterface";
import { useProject } from "@/contexts/ProjectContext";

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
  
  // Usar contexto para estado do projeto e navegação
  const { project, setProject: setContextProject, activeTab } = useProject();
  
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectId) {
      loadProject();
      loadArticles();
    }
  }, [projectId]);

  const loadProject = async () => {
    if (!projectId) return;
    
    try {
      const { data, error } = await supabase
        .from("projects")
        .select(`
          id, name, description, review_title, review_type,
          settings, assessment_scope, assessment_entity_type_id,
          condition_studied,
          created_at, updated_at
        `)
        .eq("id", projectId)
        .single();

      if (error) throw error;
      setContextProject(data);
    } catch (error: any) {
      toast.error("Erro ao carregar projeto");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadArticles = async () => {
    if (!projectId) return;
    
    try {
      const { data, error } = await supabase
        .from("articles")
        .select(`
          id, title, abstract, authors, publication_year,
          journal_title, doi, pmid, keywords, created_at
        `)
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

  // Renderizar conteúdo baseado na aba ativa
  const renderContent = () => {
    switch (activeTab) {
      case 'articles':
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-semibold">Artigos</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Gerencie os artigos da sua revisão sistemática
                </p>
              </div>
              <Button onClick={() => navigate(`/projects/${projectId}/articles/add`)}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar Artigo
              </Button>
            </div>

            <ArticlesList 
              articles={articles} 
              onArticleClick={(articleId) => navigate(`/projects/${projectId}/articles/${articleId}/edit`)}
              projectId={projectId || ''}
              onArticlesChange={loadArticles}
            />
          </div>
        );

      case 'extraction':
        return <ExtractionInterface projectId={projectId || ''} />;

      case 'assessment':
        return <AssessmentInterface projectId={projectId || ''} />;

      case 'settings':
        return <ProjectSettings projectId={projectId || ''} />;

      default:
        return null;
    }
  };

  return (
    <div className="h-full bg-background">
      {activeTab === 'settings' ? (
        // Layout wide para configurações - sem containers limitantes
        <div className="h-full">
          {renderContent()}
        </div>
      ) : (
        // Layout com container para outras abas
        <div className="container mx-auto px-6 py-6 lg:px-10 lg:py-8 h-full">
          <div className="mx-auto w-full max-w-[1200px] h-full">
            {renderContent()}
          </div>
        </div>
      )}
    </div>
  );
}
