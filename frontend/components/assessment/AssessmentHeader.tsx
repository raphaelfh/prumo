/**
 * Refactored Header - Assessment Module
 *
 * Main header component for the assessment interface.
 * Refactored to use modular sub-components (DRY + KISS).
 *
 * Based on ExtractionHeader.tsx - Modular architecture
 *
 * Sub-components:
 * - HeaderNavigation: Back button, breadcrumb, article navigation
 * - HeaderPDFControls: PDF and comparison toggles, article dropdown
 * - HeaderStatusBadges: Progress, auto-save status
 * - HeaderFinalizeButton: Finalize button
 * - HeaderMoreMenu: Dropdown menu with secondary actions
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
    // Navigation
  projectName: string;
  instrumentName: string;
  articleTitle: string;
  onBack: () => void;

    // Article navigation
  articles: Article[];
  currentArticleId: string;
  onNavigateToArticle: (articleId: string) => void;

    // Progress
  completedItems: number;
  totalItems: number;
  completionPercentage: number;

    // Controls
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

    // Status and actions
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
        <header className="border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto">
          {/* Desktop Layout (≥1024px) */}
            <div className="hidden lg:flex items-center justify-between h-12 px-6 gap-4">
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
