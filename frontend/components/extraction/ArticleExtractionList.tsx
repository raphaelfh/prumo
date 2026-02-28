/**
 * Lista de artigos com opção de iniciar/continuar extração
 * 
 * Exibe todos os artigos do projeto e permite:
 * - Iniciar extração para artigos sem extração
 * - Continuar extração para artigos em andamento
 * - Ver detalhes de extração completa
 */

import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Progress} from '@/components/ui/progress';
import {CheckCircle, Clock, Edit, FileText, Loader2, PlayCircle} from 'lucide-react';
import {type ExtractionProgress, useExtractionSetup} from '@/hooks/extraction';
import {toast} from 'sonner';

interface Article {
  id: string;
  title: string;
  authors: string[] | null;
  publication_year: number | null;
  created_at: string;
}

interface ArticleWithExtraction extends Article {
  extractionInitialized: boolean;
  extractionProgress: ExtractionProgress | null;
  isLoading: boolean;
}

interface ArticleExtractionListProps {
  projectId: string;
  templateId: string;
}

export function ArticleExtractionList({ projectId, templateId }: ArticleExtractionListProps) {
  const navigate = useNavigate();
  const { 
    initializeArticleExtraction, 
    calculateProgress, 
    isExtractionInitialized,
    loading: setupLoading 
  } = useExtractionSetup();

  const [articles, setArticles] = useState<ArticleWithExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar artigos do projeto
  useEffect(() => {
    if (projectId && templateId) {
      loadArticles();
    }
  }, [projectId, templateId]);

  const loadArticles = async () => {
    console.log('ArticleExtractionList - loadArticles chamado:', { projectId, templateId });
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

      console.log('Artigos carregados:', articlesData?.length || 0);

      if (!articlesData || articlesData.length === 0) {
        setArticles([]);
        return;
      }

      // 2. Para cada artigo, verificar status de extração
      const articlesWithExtraction = await Promise.all(
        articlesData.map(async (article) => {
          try {
            const initialized = await isExtractionInitialized(article.id, templateId);
            let progress: ExtractionProgress | null = null;

            if (initialized) {
              progress = await calculateProgress(article.id, templateId);
              console.log(`Progresso do artigo ${article.title}:`, progress);
            }

            return {
              ...article,
              extractionInitialized: initialized,
              extractionProgress: progress,
              isLoading: false,
            };
          } catch (err) {
            console.error(`Erro ao processar artigo ${article.title}:`, err);
            return {
              ...article,
              extractionInitialized: false,
              extractionProgress: null,
              isLoading: false,
            };
          }
        })
      );

      console.log('Artigos processados:', articlesWithExtraction.length);
      setArticles(articlesWithExtraction);
    } catch (err: any) {
      console.error('Erro ao carregar artigos:', err);
      setError(err.message);
      toast.error(`Erro ao carregar artigos: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartExtraction = async (articleId: string) => {
    // Atualizar estado para mostrar loading
    setArticles(prev => prev.map(a => 
      a.id === articleId ? { ...a, isLoading: true } : a
    ));

    try {
      const result = await initializeArticleExtraction(articleId, projectId, templateId);

      if (result.success) {
        // Recarregar lista para atualizar status
        await loadArticles();
        
        // Navegar para tela de extração
        navigate(`/projects/${projectId}/extraction/${articleId}`);
      } else {
        // Resetar loading em caso de erro
        setArticles(prev => prev.map(a => 
          a.id === articleId ? { ...a, isLoading: false } : a
        ));
      }
    } catch (err: any) {
      console.error('Erro ao iniciar extração:', err);
      setArticles(prev => prev.map(a => 
        a.id === articleId ? { ...a, isLoading: false } : a
      ));
    }
  };

  const handleContinueExtraction = (articleId: string) => {
    navigate(`/projects/${projectId}/extraction/${articleId}`);
  };

  const getStatusBadge = (article: ArticleWithExtraction) => {
    if (!article.extractionInitialized) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Não iniciada
        </Badge>
      );
    }

    const progress = article.extractionProgress?.progressPercentage || 0;

    if (progress >= 100) {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Carregando artigos...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            <p>Erro ao carregar artigos</p>
            <p className="text-sm text-muted-foreground mt-2">{error}</p>
            <Button onClick={loadArticles} variant="outline" className="mt-4">
              Tentar novamente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (articles.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Nenhum artigo encontrado neste projeto</p>
            <p className="text-sm mt-2">Adicione artigos primeiro para iniciar a extração de dados.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {articles.map((article) => {
        const progress = article.extractionProgress?.progressPercentage || 0;
        const requiredFields = article.extractionProgress?.totalRequiredFields || 0;
        const completedFields = article.extractionProgress?.completedRequiredFields || 0;

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
                {article.extractionInitialized && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Progresso: {completedFields} / {requiredFields} campos obrigatórios
                      </span>
                      <span className="font-medium">{progress.toFixed(1)}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}

                {/* Ações */}
                <div className="flex gap-2">
                  {!article.extractionInitialized ? (
                    <Button 
                      onClick={() => handleStartExtraction(article.id)}
                      disabled={article.isLoading || setupLoading}
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
                          Iniciar Extração
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => handleContinueExtraction(article.id)}
                      variant={progress >= 100 ? "outline" : "default"}
                      className="gap-2"
                    >
                      {progress >= 100 ? (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          Ver Extração
                        </>
                      ) : (
                        <>
                          <Edit className="h-4 w-4" />
                          Continuar Extração
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

