import React from 'react';
import { VirtualList } from '@/components/performance/VirtualList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { FileText, Eye, CheckCircle, Clock } from 'lucide-react';
import { withListMemo } from '@/components/performance/ReactMemoWrapper';

interface Article {
  id: string;
  title: string;
  abstract?: string;
  authors?: string[];
  publication_year?: number;
  status?: string;
  completion_percentage?: number;
}

interface OptimizedArticlesListProps {
  articles: Article[];
  onArticleClick: (articleId: string) => void;
  height?: number;
  className?: string;
}

const ArticleItem: React.FC<{
  article: Article;
  onArticleClick: (articleId: string) => void;
}> = React.memo(({ article, onArticleClick }) => {
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'not_started': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'in_progress': return <Clock className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  return (
    <Card className="mb-4 hover:shadow-md transition-shadow cursor-pointer" 
          onClick={() => onArticleClick(article.id)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg line-clamp-2 flex-1">
            {article.title}
          </CardTitle>
          <Badge className={`ml-2 ${getStatusColor(article.status)}`}>
            {getStatusIcon(article.status)}
            <span className="ml-1 capitalize">
              {article.status?.replace('_', ' ') || 'Not Started'}
            </span>
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        {article.abstract && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {article.abstract}
          </p>
        )}
        
        {article.authors && article.authors.length > 0 && (
          <p className="text-xs text-muted-foreground mb-2">
            {article.authors.slice(0, 3).join(', ')}
            {article.authors.length > 3 && ` +${article.authors.length - 3} more`}
          </p>
        )}
        
        {article.publication_year && (
          <p className="text-xs text-muted-foreground mb-2">
            {article.publication_year}
          </p>
        )}
        
        {article.completion_percentage !== undefined && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Progress</span>
              <span>{article.completion_percentage}%</span>
            </div>
            <Progress value={article.completion_percentage} className="h-2" />
          </div>
        )}
      </CardContent>
    </Card>
  );
});

ArticleItem.displayName = 'ArticleItem';

const OptimizedArticlesListComponent: React.FC<OptimizedArticlesListProps> = ({
  articles,
  onArticleClick,
  height = 600,
  className = '',
}) => {
  const renderItem = React.useCallback((article: Article, index: number) => (
    <ArticleItem
      key={article.id}
      article={article}
      onArticleClick={onArticleClick}
    />
  ), [onArticleClick]);

  const keyExtractor = React.useCallback((article: Article, index: number) => 
    article.id, []
  );

  if (articles.length === 0) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ height }}>
        <div className="text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Nenhum artigo encontrado</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <VirtualList
        items={articles}
        itemHeight={180} // Altura estimada do card
        containerHeight={height}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        overscan={3}
        className="pr-2"
      />
    </div>
  );
};

// Componente otimizado com memoização
export const OptimizedArticlesList = withListMemo(
  OptimizedArticlesListComponent,
  (props) => props.articles.length.toString()
);
