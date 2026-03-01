import {useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";
import {Plus} from "lucide-react";
import {toast} from "sonner";
import {ArticlesList} from "@/components/articles/ArticlesList";
import {ProjectSettings} from "@/components/project/ProjectSettings";
import {AssessmentInterface} from "@/components/assessment/AssessmentInterface";
import {ExtractionInterface} from "@/components/extraction/ExtractionInterface";
import {useProject} from "@/contexts/ProjectContext";

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
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Artigos</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Gerencie os artigos da sua revisão sistemática
                </p>
              </div>
                <Button
                    onClick={() => navigate(`/projects/${projectId}/articles/add`)}
                    className="bg-[#111111] hover:bg-[#2c2c2c] text-white rounded-md h-9 px-4 text-xs font-medium transition-all"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5"/>
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
          // Layout com container mais largo e padding ajustado para estilo Linear
          <div className="w-full px-6 py-8 lg:px-10 h-full overflow-y-auto">
            <div className="w-full max-w-[1400px] mx-auto h-full">
            {renderContent()}
          </div>
        </div>
      )}
    </div>
  );
}
