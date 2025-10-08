/**
 * Lista de artigos para avaliação
 * 
 * Exibe todos os artigos do projeto e permite:
 * - Iniciar avaliação para artigos sem avaliação
 * - Continuar avaliação para artigos em andamento
 * - Ver detalhes de avaliação completa
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  FileText, 
  PlayCircle, 
  Edit, 
  CheckCircle, 
  Clock,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface Article {
  id: string;
  title: string;
  authors: string[] | null;
  publication_year: number | null;
  created_at: string;
}

interface Assessment {
  id: string;
  article_id: string;
  instrument_id: string;
  status: string;
  completion_percentage: number;
  updated_at: string;
}

interface ArticleWithAssessment extends Article {
  assessment: Assessment | null;
  isLoading: boolean;
}

interface ArticleAssessmentListProps {
  projectId: string;
  instrumentId: string;
}

export function ArticleAssessmentList({ projectId, instrumentId }: ArticleAssessmentListProps) {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<ArticleWithAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Carregar ID do usuário atual
  useEffect(() => {
    loadCurrentUser();
  }, []);

  // Carregar artigos do projeto
  useEffect(() => {
    if (projectId && instrumentId && currentUserId) {
      loadArticles();
    }
  }, [projectId, instrumentId, currentUserId]);

  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }
    } catch (error: any) {
      console.error('Erro ao carregar usuário:', error);
    }
  };

  const loadArticles = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Buscar artigos do projeto
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title, authors, publication_year, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (articlesError) {
        console.error('Erro ao buscar artigos:', articlesError);
        throw articlesError;
      }

      if (!articlesData || articlesData.length === 0) {
        setArticles([]);
        return;
      }

      // 2. Buscar avaliações do usuário atual para esses artigos
      const { data: assessmentsData, error: assessmentsError } = await supabase
        .from('assessments')
        .select('*')
        .eq('project_id', projectId)
        .eq('instrument_id', instrumentId)
        .eq('user_id', currentUserId)
        .eq('is_current_version', true);

      if (assessmentsError) {
        console.error('Erro ao buscar avaliações:', assessmentsError);
        throw assessmentsError;
      }

      // 3. Combinar artigos com suas avaliações
      const articlesWithAssessment: ArticleWithAssessment[] = articlesData.map(article => {
        const assessment = assessmentsData?.find(a => a.article_id === article.id) || null;
        return {
          ...article,
          assessment,
          isLoading: false,
        };
      });

      setArticles(articlesWithAssessment);
    } catch (err: any) {
      console.error('Erro ao carregar artigos:', err);
      setError(err.message);
      toast.error(`Erro ao carregar artigos: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartAssessment = (articleId: string) => {
    navigate(`/projects/${projectId}/assessment/${articleId}/${instrumentId}`);
  };

  const handleContinueAssessment = (articleId: string) => {
    navigate(`/projects/${projectId}/assessment/${articleId}/${instrumentId}`);
  };

  const getStatusBadge = (article: ArticleWithAssessment) => {
    if (!article.assessment) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Não iniciada
        </Badge>
      );
    }

    const progress = article.assessment.completion_percentage || 0;

    if (article.assessment.status === 'submitted' || progress >= 100) {
      return (
        <Badge variant="default" className="gap-1 bg-green-500">
          <CheckCircle className="h-3 w-3" />
          Completa
        </Badge>
      );
    }

    return (
      <Badge variant="default" className="gap-1 bg-blue-500">
        <Edit className="h-3 w-3" />
        Em andamento
      </Badge>
    );
  };

  // Estado: Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Carregando artigos...</span>
      </div>
    );
  }

  // Estado: Error
  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <div className="flex items-center space-x-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <div>
              <p className="font-medium">Erro ao carregar artigos</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
          <Button onClick={loadArticles} variant="outline" className="mt-4">
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Estado: Empty
  if (articles.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground py-8">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">Nenhum artigo encontrado neste projeto</p>
            <p className="text-sm mt-2">Adicione artigos primeiro para iniciar as avaliações.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Estado: Ready - Renderizar lista de artigos
  return (
    <div className="space-y-4">
      {articles.map((article) => {
        const progress = article.assessment?.completion_percentage || 0;
        const isComplete = article.assessment?.status === 'submitted' || progress >= 100;

        return (
          <Card key={article.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg">{article.title}</CardTitle>
                  <CardDescription className="mt-1">
                    {article.authors && article.authors.length > 0 && `${article.authors.join(', ')} • `}
                    {article.publication_year || 'Ano não especificado'}
                  </CardDescription>
                </div>
                <div className="ml-4">
                  {getStatusBadge(article)}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Progresso */}
                {article.assessment && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Progresso da avaliação
                      </span>
                      <span className="font-medium">{progress.toFixed(0)}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}

                {/* Ações */}
                <div className="flex gap-2">
                  {!article.assessment ? (
                    <Button 
                      onClick={() => handleStartAssessment(article.id)}
                      disabled={article.isLoading}
                      className="gap-2"
                    >
                      {article.isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Iniciando...
                        </>
                      ) : (
                        <>
                          <PlayCircle className="h-4 w-4" />
                          Iniciar Avaliação
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => handleContinueAssessment(article.id)}
                      variant={isComplete ? "outline" : "default"}
                      className="gap-2"
                    >
                      {isComplete ? (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          Ver Avaliação
                        </>
                      ) : (
                        <>
                          <Edit className="h-4 w-4" />
                          Continuar Avaliação
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

