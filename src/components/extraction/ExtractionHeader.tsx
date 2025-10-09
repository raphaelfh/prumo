/**
 * Header unificado da interface de extração
 * 
 * Componente minimalista que consolida:
 * - Navegação (voltar + breadcrumb)
 * - Progresso de completude
 * - Controles de visualização (PDF toggle + modo comparação)
 * - Status de auto-save
 * - Ação principal (finalizar)
 * 
 * @component
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ArrowLeft, Loader2, Clock, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

// =================== INTERFACES ===================

interface Article {
  id: string;
  title: string;
}

interface ExtractionHeaderProps {
  // Navegação
  projectId: string;
  projectName: string;
  articleTitle: string;
  onBack: () => void;
  
  // Navegação entre artigos
  articles: Article[];
  currentArticleId: string;
  onNavigateToArticle: (articleId: string) => void;
  
  // Progresso
  completedFields: number;
  totalFields: number;
  completionPercentage: number;
  
  // Controles de view
  showPDF: boolean;
  onTogglePDF: () => void;
  viewMode: 'extract' | 'compare';
  onViewModeChange: (mode: 'extract' | 'compare') => void;
  hasOtherExtractions: boolean;
  
  // Status e ações
  isSaving?: boolean;
  lastSaved?: Date | null;
  isComplete: boolean;
  onFinalize: () => void;
  submitting?: boolean;
}

// =================== COMPONENT ===================

export function ExtractionHeader(props: ExtractionHeaderProps) {
  const navigate = useNavigate();
  const {
    projectId,
    projectName,
    articleTitle,
    onBack,
    articles,
    currentArticleId,
    onNavigateToArticle,
    completedFields,
    totalFields,
    completionPercentage,
    showPDF,
    onTogglePDF,
    viewMode,
    onViewModeChange,
    hasOtherExtractions,
    isSaving = false,
    lastSaved = null,
    isComplete,
    onFinalize,
    submitting = false
  } = props;

  // Encontrar posição do artigo atual e artigos adjacentes
  const currentIndex = articles.findIndex(article => article.id === currentArticleId);
  const previousArticle = currentIndex > 0 ? articles[currentIndex - 1] : null;
  const nextArticle = currentIndex < articles.length - 1 ? articles[currentIndex + 1] : null;

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between px-6 py-3.5">
        {/* Navegação (esquerda) */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          
          <Separator orientation="vertical" className="h-5" />
          
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  onClick={() => navigate(`/projects/${projectId}`)}
                  className="cursor-pointer hover:text-foreground"
                >
                  {projectName}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="max-w-[400px] truncate">
                  {articleTitle}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        {/* Seção de Edição (centro-esquerda) */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onTogglePDF}
          >
            {showPDF ? 'Ocultar PDF' : 'Mostrar PDF'}
          </Button>
          
          {/* Navegação entre artigos */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => previousArticle && onNavigateToArticle(previousArticle.id)}
              disabled={!previousArticle}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => nextArticle && onNavigateToArticle(nextArticle.id)}
              disabled={!nextArticle}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          {hasOtherExtractions && (
            <>
              <Separator orientation="vertical" className="h-5" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewModeChange(viewMode === 'extract' ? 'compare' : 'extract')}
              >
                Comparação
              </Button>
            </>
          )}
        </div>

        {/* Seção de Status (centro-direita) */}
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            <span className="text-muted-foreground">Progresso:</span>
            <span className="font-semibold tabular-nums ml-1">{completionPercentage}%</span>
            <span className="text-muted-foreground ml-1">({completedFields}/{totalFields})</span>
          </Badge>
          
          {/* Auto-save indicator */}
          {isSaving ? (
            <Badge variant="outline" className="gap-2 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              Salvando...
            </Badge>
          ) : lastSaved ? (
            <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Salvo {format(lastSaved, 'HH:mm', { locale: ptBR })}
            </Badge>
          ) : null}
        </div>

        {/* Ação Principal (direita) */}
        <div className="flex items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onFinalize}
            disabled={!isComplete || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Finalizando...
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                Finalizar
              </>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}

