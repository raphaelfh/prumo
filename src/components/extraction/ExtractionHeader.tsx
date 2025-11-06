/**
 * Header unificado da interface de extração
 * 
 * Componente refatorado seguindo princípios DRY, KISS, unificado e responsivo.
 * Usa componentes menores extraídos para melhor manutenibilidade.
 * 
 * @component
 */

import {
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { type UserRole } from '@/lib/comparison/permissions';
import { HeaderNavigation } from './header/HeaderNavigation';
import { HeaderPDFControls } from './header/HeaderPDFControls';
import { HeaderStatusBadges } from './header/HeaderStatusBadges';
import { HeaderFinalizeButton } from './header/HeaderFinalizeButton';
import { HeaderAIActions } from './header/HeaderAIActions';
import { HeaderMoreMenu } from './header/HeaderMoreMenu';
import type { AISuggestion } from '@/types/ai-extraction';
import type { 
  ProjectExtractionTemplate, 
  ExtractionInstance, 
  ExtractedValue 
} from '@/types/extraction';

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
  
  // AI Extraction (opcional - mantido para compatibilidade)
  templateId?: string;
  templateName?: string;
  onExtractionComplete?: (runId?: string) => void | Promise<void>;
  
  // Sugestões de IA (para badge na Zona 4)
  aiSuggestions?: Record<string, AISuggestion>;
  onAISuggestionsClick?: () => void;
  
  // Dados para export (Zona 4 - Menu Mais)
  template?: ProjectExtractionTemplate | null;
  instances?: ExtractionInstance[];
  values?: ExtractedValue[];
}

// =================== COMPONENT ===================

export function ExtractionHeader(props: ExtractionHeaderProps) {
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
    submitting = false,
    aiSuggestions = {},
    onAISuggestionsClick,
    template,
    instances = [],
    values = [],
  } = props;

  const isMobile = useIsMobile();

  return (
    <TooltipProvider delayDuration={200}>
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-sm relative z-10 shadow-sm">
        {isMobile ? (
          /* Mobile Layout: Minimalista e organizado */
          <div className="flex flex-col px-4 py-2.5 gap-2.5">
            {/* Linha 1: Navegação + Status + Finalizar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <HeaderNavigation
                  projectId={projectId}
                  projectName={projectName}
                  articleTitle={articleTitle}
                  onBack={onBack}
                  showBackText={false}
                  maxBreadcrumbWidth="200px"
                  articles={articles}
                  currentArticleId={currentArticleId}
                  onNavigateToArticle={onNavigateToArticle}
                />
              </div>
              
              <div className="flex items-center gap-2 flex-shrink-0">
                <HeaderStatusBadges
                  userRole={userRole}
                  isBlindMode={isBlindMode}
                  completedFields={completedFields}
                  totalFields={totalFields}
                  completionPercentage={completionPercentage}
                  isSaving={isSaving}
                  lastSaved={lastSaved}
                  compact={true}
                />
              </div>
              
              <div className="flex-shrink-0">
                <HeaderFinalizeButton
                  isComplete={isComplete}
                  onSubmit={onFinalize}
                  submitting={submitting}
                  variant="default"
                  size="sm"
                />
              </div>
            </div>

            {/* Linha 2: Controles PDF + Ações Secundárias */}
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <HeaderPDFControls
                showPDF={showPDF}
                onTogglePDF={onTogglePDF}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                hasOtherExtractions={hasOtherExtractions}
                compact={true}
              />
              
              {/* Zona 4: Ações Secundárias (Mobile) */}
              <div className="flex items-center gap-2">
                <HeaderAIActions
                  suggestions={aiSuggestions}
                  onClick={onAISuggestionsClick}
                  compact={true}
                />
                <HeaderMoreMenu
                  projectId={projectId}
                  template={template}
                  instances={instances}
                  values={values}
                  compact={true}
                />
              </div>
            </div>
          </div>
        ) : (
          /* Desktop Layout: 5 Zonas conforme análise UX */
          <div className="flex items-center justify-between gap-6 px-6 py-3.5">
            {/* Zona 1: Navegação Contextual (Extrema Esquerda) */}
            <div className="flex-1 min-w-0">
              <HeaderNavigation
                projectId={projectId}
                projectName={projectName}
                articleTitle={articleTitle}
                onBack={onBack}
                showBackText={true}
                maxBreadcrumbWidth="400px"
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
              />
            </div>

            {/* Zona 2: Controles de Visualização (Centro-Esquerda) */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <HeaderPDFControls
                showPDF={showPDF}
                onTogglePDF={onTogglePDF}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                hasOtherExtractions={hasOtherExtractions}
                compact={false}
              />
            </div>

            {/* Zona 3: Status e Feedback (Centro) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <HeaderStatusBadges
                userRole={userRole}
                isBlindMode={isBlindMode}
                completedFields={completedFields}
                totalFields={totalFields}
                completionPercentage={completionPercentage}
                isSaving={isSaving}
                lastSaved={lastSaved}
                compact={false}
              />
            </div>

            {/* Zona 4: Ações Secundárias (Centro-Direita) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <HeaderAIActions
                suggestions={aiSuggestions}
                onClick={onAISuggestionsClick}
                compact={false}
              />
              <HeaderMoreMenu
                projectId={projectId}
                template={template}
                instances={instances}
                values={values}
                compact={false}
              />
            </div>

            {/* Zona 5: Ação Principal (Extrema Direita) */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <HeaderFinalizeButton
                isComplete={isComplete}
                onSubmit={onFinalize}
                submitting={submitting}
                variant="default"
                size="sm"
              />
            </div>
          </div>
        )}
      </header>
    </TooltipProvider>
  );
}
