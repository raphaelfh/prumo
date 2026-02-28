/**
 * Header Refatorado - Assessment Module
 *
 * Componente principal do header da interface de avaliação.
 * REFATORADO para usar sub-componentes modulares (DRY + KISS).
 *
 * Baseado em ExtractionHeader.tsx - Arquitetura modular
 *
 * Sub-componentes:
 * - HeaderNavigation: Botão voltar, breadcrumb, navegação artigos
 * - HeaderPDFControls: Toggles de PDF e comparação, dropdown artigos
 * - HeaderStatusBadges: Progresso, auto-save status
 * - HeaderFinalizeButton: Botão de finalização
 * - HeaderMoreMenu: Menu dropdown com ações secundárias
 *
 * @component
 */

import {TooltipProvider} from '@/components/ui/tooltip';
import {HeaderNavigation} from './header/HeaderNavigation';
import {HeaderPDFControls} from './header/HeaderPDFControls';
import {HeaderStatusBadges} from './header/HeaderStatusBadges';
import {HeaderFinalizeButton} from './header/HeaderFinalizeButton';
import {HeaderMoreMenu} from './header/HeaderMoreMenu';

// =================== INTERFACES ===================

interface Article {
  id: string;
  title: string;
}

export interface AssessmentHeaderProps {
  // Navegação
  projectName: string;
  instrumentName: string;
  articleTitle: string;
  onBack: () => void;

  // Navegação entre artigos
  articles: Article[];
  currentArticleId: string;
  onNavigateToArticle: (articleId: string) => void;

  // Progresso
  completedItems: number;
  totalItems: number;
  completionPercentage: number;

  // Controles
  showPDF: boolean;
  onTogglePDF: () => void;
  showComparison: boolean;
  onToggleComparison: () => void;
  hasOtherAssessments: boolean;

  // Undo/Redo
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  // Status e ações
  isSaving?: boolean;
  lastSaved?: Date | null;
  isComplete: boolean;
  onFinalize: () => void;
  submitting?: boolean;

  // AI Actions slot (rendered in header right section)
  aiActions?: React.ReactNode;
}

// =================== COMPONENT ===================

export function AssessmentHeader(props: AssessmentHeaderProps) {
  const {
    projectName,
    instrumentName,
    articleTitle,
    onBack,
    articles,
    currentArticleId,
    onNavigateToArticle,
    completedItems,
    totalItems,
    completionPercentage,
    showPDF,
    onTogglePDF,
    showComparison,
    onToggleComparison,
    hasOtherAssessments,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    isSaving,
    lastSaved,
    isComplete,
    onFinalize,
    submitting,
    aiActions,
  } = props;

  return (
    <TooltipProvider>
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="container mx-auto">
          {/* Desktop Layout (≥1024px) */}
          <div className="hidden lg:flex items-center justify-between h-16 px-6 gap-4">
            {/* Left: Navigation */}
            <HeaderNavigation
              projectName={projectName}
              instrumentName={instrumentName}
              articleTitle={articleTitle}
              onBack={onBack}
              articles={articles}
              currentArticleId={currentArticleId}
              onNavigateToArticle={onNavigateToArticle}
            />

            {/* Center: Status Badges */}
            <HeaderStatusBadges
              completedItems={completedItems}
              totalItems={totalItems}
              completionPercentage={completionPercentage}
              isSaving={isSaving}
              lastSaved={lastSaved}
              isComplete={isComplete}
            />

            {/* Right: Controls + Actions */}
            <div className="flex items-center gap-3">
              <HeaderPDFControls
                showPDF={showPDF}
                onTogglePDF={onTogglePDF}
                showComparison={showComparison}
                onToggleComparison={onToggleComparison}
                hasOtherAssessments={hasOtherAssessments}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
              />
              {aiActions && (
                <>
                  <div className="h-6 w-px bg-border" />
                  {aiActions}
                </>
              )}
              <div className="h-6 w-px bg-border" />
              <HeaderFinalizeButton
                isComplete={isComplete}
                onFinalize={onFinalize}
                submitting={submitting}
              />
              <HeaderMoreMenu
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={onUndo}
                onRedo={onRedo}
              />
            </div>
          </div>

          {/* Tablet Layout (768px - 1023px) */}
          <div className="hidden md:flex lg:hidden flex-col gap-3 py-3 px-4">
            {/* Row 1: Navigation + More Menu */}
            <div className="flex items-center justify-between">
              <HeaderNavigation
                projectName={projectName}
                instrumentName={instrumentName}
                articleTitle={articleTitle}
                onBack={onBack}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
              />
              <HeaderMoreMenu
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={onUndo}
                onRedo={onRedo}
              />
            </div>

            {/* Row 2: Status + Controls + Finalize */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HeaderStatusBadges
                  completedItems={completedItems}
                  totalItems={totalItems}
                  completionPercentage={completionPercentage}
                  isSaving={isSaving}
                  lastSaved={lastSaved}
                  isComplete={isComplete}
                />
                <HeaderPDFControls
                  showPDF={showPDF}
                  onTogglePDF={onTogglePDF}
                  showComparison={showComparison}
                  onToggleComparison={onToggleComparison}
                  hasOtherAssessments={hasOtherAssessments}
                  articles={articles}
                  currentArticleId={currentArticleId}
                  onNavigateToArticle={onNavigateToArticle}
                />
              </div>
              <div className="flex items-center gap-2">
                {aiActions}
                <HeaderFinalizeButton
                  isComplete={isComplete}
                  onFinalize={onFinalize}
                  submitting={submitting}
                />
              </div>
            </div>
          </div>

          {/* Mobile Layout (<768px) */}
          <div className="flex md:hidden flex-col gap-3 py-3 px-4">
            {/* Row 1: Back + Title + More Menu */}
            <div className="flex items-center justify-between">
              <HeaderNavigation
                projectName={projectName}
                instrumentName={instrumentName}
                articleTitle={articleTitle}
                onBack={onBack}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
              />
              <HeaderMoreMenu
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={onUndo}
                onRedo={onRedo}
              />
            </div>

            {/* Row 2: Status */}
            <HeaderStatusBadges
              completedItems={completedItems}
              totalItems={totalItems}
              completionPercentage={completionPercentage}
              isSaving={isSaving}
              lastSaved={lastSaved}
              isComplete={isComplete}
            />

            {/* Row 3: AI Actions (if available) */}
            {aiActions && (
              <div className="flex items-center gap-2">
                {aiActions}
              </div>
            )}

            {/* Row 4: Controls + Finalize */}
            <div className="flex items-center justify-between gap-2">
              <HeaderPDFControls
                showPDF={showPDF}
                onTogglePDF={onTogglePDF}
                showComparison={showComparison}
                onToggleComparison={onToggleComparison}
                hasOtherAssessments={hasOtherAssessments}
                articles={articles}
                currentArticleId={currentArticleId}
                onNavigateToArticle={onNavigateToArticle}
              />
              <HeaderFinalizeButton
                isComplete={isComplete}
                onFinalize={onFinalize}
                submitting={submitting}
              />
            </div>
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
}
