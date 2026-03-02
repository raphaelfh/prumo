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

const TAB_DESCRIPTIONS: Record<string, string> = {
  extraction: 'Extraia dados estruturados usando templates padronizados',
  assessment: 'Avalie a qualidade metodológica dos artigos',
};

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
            <ArticlesList
                articles={articles}
                onArticleClick={(articleId) => navigate(`/projects/${projectId}/articles/${articleId}/edit`)}
                projectId={projectId || ''}
                onArticlesChange={loadArticles}
            />
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
      <div className="h-full bg-background flex flex-col">

        {/* Sticky action bar — outside scroll container for edge-to-edge sticking */}
        {activeTab !== 'settings' && (
            <div
                className="flex-shrink-0 h-11 flex items-center justify-between border-b border-border/30 bg-background/80 backdrop-blur-sm px-6 lg:px-10">
          <span className="text-[12px] text-muted-foreground/70">
            {activeTab === 'articles'
                ? `${articles.length} artigo${articles.length !== 1 ? 's' : ''}`
                : (TAB_DESCRIPTIONS[activeTab] ?? '')}
          </span>
              {activeTab === 'articles' && (
                  <Button
                      size="sm"
                      onClick={() => navigate(`/projects/${projectId}/articles/add`)}
                      className="h-7 px-3 text-[12px] font-medium rounded-md"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5"/>
                    Adicionar Artigo
                  </Button>
              )}
            </div>
        )}

      {activeTab === 'settings' ? (
          <div className="flex-1 overflow-y-auto">{renderContent()}</div>
      ) : (
          <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-10">
            <div className="w-full max-w-[1400px] mx-auto">
            {renderContent()}
          </div>
        </div>
      )}
    </div>
  );
}
