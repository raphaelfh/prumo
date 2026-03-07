/**
 * Article list with option to start/continue extraction
 *
 * Shows all project articles and allows:
 * - Start extraction for articles without extraction
 * - Continue extraction for in-progress articles
 * - View full extraction details
 */

import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Progress} from '@/components/ui/progress';
import {Skeleton} from '@/components/ui/skeleton';
import {CheckCircle, Clock, Edit, FileText, Loader2, PlayCircle} from 'lucide-react';
import {type ExtractionProgress, useExtractionSetup} from '@/hooks/extraction';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

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

    // Load project articles
  useEffect(() => {
    if (projectId && templateId) {
      loadArticles();
    }
  }, [projectId, templateId]);

  const loadArticles = async () => {
      console.warn('ArticleExtractionList - loadArticles called:', {projectId, templateId});
    setLoading(true);
    setError(null);

    try {
        // 1. Fetch project articles
      const { data: articlesData, error: articlesError } = await supabase
        .from('articles')
        .select('id, title, authors, publication_year, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (articlesError) {
          console.error('Error fetching articles:', articlesError);
        throw articlesError;
      }

        console.warn('Articles loaded:', articlesData?.length || 0);

      if (!articlesData || articlesData.length === 0) {
        setArticles([]);
        return;
      }

        // 2. For each article, check extraction status
      const articlesWithExtraction = await Promise.all(
        articlesData.map(async (article) => {
          try {
            const initialized = await isExtractionInitialized(article.id, templateId);
            let progress: ExtractionProgress | null = null;

            if (initialized) {
              progress = await calculateProgress(article.id, templateId);
                console.warn(`Article progress ${article.title}:`, progress);
            }

            return {
              ...article,
              extractionInitialized: initialized,
              extractionProgress: progress,
              isLoading: false,
            };
          } catch (err) {
              console.error(`Error processing article ${article.title}:`, err);
            return {
              ...article,
              extractionInitialized: false,
              extractionProgress: null,
              isLoading: false,
            };
          }
        })
      );

        console.warn('Articles processed:', articlesWithExtraction.length);
      setArticles(articlesWithExtraction);
    } catch (err: any) {
        console.error('Error loading articles:', err);
      setError(err.message);
        toast.error(`${t('extraction', 'listErrorLoadArticles')}: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartExtraction = async (articleId: string) => {
      // Update state to show loading
    setArticles(prev => prev.map(a => 
      a.id === articleId ? { ...a, isLoading: true } : a
    ));

    try {
      const result = await initializeArticleExtraction(articleId, projectId, templateId);

      if (result.success) {
          // Reload list to update status
        await loadArticles();

          // Navigate to extraction screen
        navigate(`/projects/${projectId}/extraction/${articleId}`);
      } else {
          // Reset loading on error
        setArticles(prev => prev.map(a => 
          a.id === articleId ? { ...a, isLoading: false } : a
        ));
      }
    } catch (err: any) {
        console.error('Error starting extraction:', err);
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
            {t('extraction', 'listStatusNotStarted')}
        </Badge>
      );
    }

    const progress = article.extractionProgress?.progressPercentage || 0;

    if (progress >= 100) {
      return (
        <Badge variant="default" className="gap-1 bg-green-500">
          <CheckCircle className="h-3 w-3" />
            {t('extraction', 'listStatusComplete')}
        </Badge>
      );
    }

    return (
      <Badge variant="default" className="gap-1 bg-blue-500">
        <Edit className="h-3 w-3" />
          {t('extraction', 'listStatusInProgress')}
      </Badge>
    );
  };

  if (loading) {
    return (
        <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="border-border/40">
                    <CardHeader className="pb-2">
                        <div className="flex justify-between gap-4">
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-full max-w-[80%]"/>
                                <Skeleton className="h-3 w-48"/>
                            </div>
                            <Skeleton className="h-6 w-24"/>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 w-40"/>
                            <Skeleton className="h-3 w-10"/>
                        </div>
                        <Skeleton className="h-2 w-full"/>
                        <Skeleton className="h-8 w-32"/>
                    </CardContent>
                </Card>
            ))}
      </div>
    );
  }

  if (error) {
    return (
        <Card className="border-border/40">
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
              <p className="text-[13px]">{t('extraction', 'listErrorLoadArticles')}</p>
              <p className="text-[13px] text-muted-foreground mt-2">{error}</p>
            <Button onClick={loadArticles} variant="outline" className="mt-4">
                {t('extraction', 'listTryAgain')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (articles.length === 0) {
    return (
        <Card className="border-border/40">
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-4 opacity-50" strokeWidth={1.5}/>
              <p className="text-[13px] font-medium">{t('extraction', 'listNoArticles')}</p>
              <p className="text-[13px] mt-2">{t('extraction', 'listNoArticlesDesc')}</p>
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
            <Card key={article.id}
                  className="border-border/40 hover:bg-muted/30 transition-[background-color] duration-75">
                <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                    <CardTitle className="text-[13px] font-medium leading-tight">{article.title}</CardTitle>
                    <CardDescription className="mt-1 text-[13px]">
                    {article.authors && article.authors.length > 0 && `${article.authors.join(', ')} • `}
                        {article.publication_year || t('extraction', 'listYearNotSpecified')}
                  </CardDescription>
                </div>
                <div className="ml-4">
                  {getStatusBadge(article)}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {article.extractionInitialized && (
                  <div className="space-y-2">
                      <div className="flex items-center justify-between text-[13px]">
                      <span className="text-muted-foreground">
                        Progress: {completedFields} / {requiredFields} {t('extraction', 'listProgressRequiredFields')}
                      </span>
                      <span className="font-medium">{progress.toFixed(1)}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}

                <div className="flex gap-2">
                  {!article.extractionInitialized ? (
                    <Button 
                      onClick={() => handleStartExtraction(article.id)}
                      disabled={article.isLoading || setupLoading}
                      size="sm"
                      className="gap-2 h-8 text-[13px]"
                    >
                      {article.isLoading ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5}/>
                            {t('extraction', 'listStarting')}
                        </>
                      ) : (
                        <>
                            <PlayCircle className="h-4 w-4" strokeWidth={1.5}/>
                            {t('extraction', 'listStartExtraction')}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => handleContinueExtraction(article.id)}
                      variant={progress >= 100 ? "outline" : "default"}
                      size="sm"
                      className="gap-2 h-8 text-[13px]"
                    >
                      {progress >= 100 ? (
                        <>
                            <CheckCircle className="h-4 w-4" strokeWidth={1.5}/>
                            {t('extraction', 'listViewExtraction')}
                        </>
                      ) : (
                        <>
                            <Edit className="h-4 w-4" strokeWidth={1.5}/>
                            {t('extraction', 'listContinueExtraction')}
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

