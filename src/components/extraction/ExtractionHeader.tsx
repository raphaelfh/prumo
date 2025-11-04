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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ArrowLeft, Loader2, Clock, CheckCircle, ChevronLeft, ChevronRight, MoreHorizontal, FileText, Users, Eye, EyeOff } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { getRoleLabel, type UserRole } from '@/lib/comparison/permissions';

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
  
  // Permissões e role (opcional)
  userRole?: UserRole;
  isBlindMode?: boolean;
  
  // Status e ações
  isSaving?: boolean;
  lastSaved?: Date | null;
  isComplete: boolean;
  onFinalize: () => void;
  submitting?: boolean;
  
  // AI Extraction (opcional)
  templateId?: string;
  templateName?: string;
  onExtractionComplete?: (runId: string) => void;
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
    userRole,
    isBlindMode,
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
    <TooltipProvider>
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Desktop Layout (1280px+) */}
        <div className="hidden xl:flex items-center justify-between px-6 py-3.5">
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
            {/* Badge de Role */}
            {userRole && (
              <Badge variant="secondary" className="text-xs gap-1">
                {getRoleLabel(userRole)}
              </Badge>
            )}
            
            {/* Badge de Blind Mode */}
            {isBlindMode && (
              <Badge variant="outline" className="text-xs gap-1">
                <EyeOff className="h-3 w-3" />
                Modo Cego
              </Badge>
            )}

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
          <div className="flex items-center gap-2">
            {/* Nota: Extração com IA agora é feita por seção via botão inline em cada SectionAccordion */}
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

        {/* Tablet Layout (768px - 1279px) */}
        <div className="hidden lg:flex xl:hidden flex-col px-6 py-3 space-y-2">
          {/* Linha 1: Navegação + Título + Finalizar */}
          <div className="flex items-center justify-between">
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
                    <BreadcrumbPage className="max-w-[250px] truncate">
                      {articleTitle}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
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

          {/* Linha 2: Controles + Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onTogglePDF}
                    className="h-8 w-8 p-0"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showPDF ? 'Ocultar PDF' : 'Mostrar PDF'}</TooltipContent>
              </Tooltip>
              
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewModeChange(viewMode === 'extract' ? 'compare' : 'extract')}
                      className="h-8 w-8 p-0"
                    >
                      <Users className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Comparação</TooltipContent>
                </Tooltip>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <span className="font-semibold tabular-nums">{completionPercentage}%</span>
                <span className="text-muted-foreground ml-1">({completedFields}/{totalFields})</span>
              </Badge>
              
              {isSaving ? (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Salvando...
                </Badge>
              ) : lastSaved ? (
                <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {format(lastSaved, 'HH:mm', { locale: ptBR })}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        {/* Mobile Layout (< 768px) */}
        <div className="flex lg:hidden flex-col px-4 py-3 space-y-3">
          {/* Linha 1: Voltar + Título + Menu */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Button variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage className="max-w-[200px] truncate text-sm">
                      {articleTitle}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onTogglePDF}>
                  <FileText className="mr-2 h-4 w-4" />
                  {showPDF ? 'Ocultar PDF' : 'Mostrar PDF'}
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => previousArticle && onNavigateToArticle(previousArticle.id)}
                  disabled={!previousArticle}
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Artigo Anterior
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => nextArticle && onNavigateToArticle(nextArticle.id)}
                  disabled={!nextArticle}
                >
                  <ChevronRight className="mr-2 h-4 w-4" />
                  Próximo Artigo
                </DropdownMenuItem>
                
                {hasOtherExtractions && (
                  <DropdownMenuItem onClick={() => onViewModeChange(viewMode === 'extract' ? 'compare' : 'extract')}>
                    <Users className="mr-2 h-4 w-4" />
                    Comparação
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Linha 2: Progresso + Finalizar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <span className="font-semibold tabular-nums">{completionPercentage}%</span>
                <span className="text-muted-foreground ml-1">({completedFields}/{totalFields})</span>
              </Badge>
              
              {isSaving ? (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Salvando...
                </Badge>
              ) : lastSaved ? (
                <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {format(lastSaved, 'HH:mm', { locale: ptBR })}
                </Badge>
              ) : null}
            </div>
            
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
    </TooltipProvider>
  );
}

