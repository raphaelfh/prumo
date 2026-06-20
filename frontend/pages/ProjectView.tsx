import {useEffect, useRef, useState} from "react";
import {useNavigate, useParams, useSearchParams} from "react-router-dom";
import {loadProjectById, loadProjectArticles} from "@/services/projectsService";
import {Button} from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {Plus, ChevronDown, Upload, FileText, Download, FileBarChart, LayoutDashboard, ListChecks} from "lucide-react";
import {ComingSoonPanel} from "@/components/layout/ComingSoonPanel";
import {toast} from "sonner";
import {ArticlesList, type ArticlesListHandle} from "@/components/articles/ArticlesList";
import {ArticleForm} from "@/components/articles/ArticleForm";
import {Sheet, SheetContent} from "@/components/ui/sheet";
import {ProjectSettings} from "@/components/project/ProjectSettings";
import {ExtractionInterface} from "@/components/extraction/ExtractionInterface";
import {QualityAssessmentInterface} from "@/components/quality/QualityAssessmentInterface";
import {ZoteroImportDialog} from "@/components/articles/ZoteroImportDialog";
import {RISImportDialog} from "@/components/articles/RISImportDialog";
import {useProject} from "@/contexts/ProjectContext";
import {useZoteroIntegration} from "@/hooks/useZoteroIntegration";
import {useProjectMemberRole} from "@/hooks/useProjectMemberRole";
import {t} from "@/lib/copy";
import type {Article} from "@/types/article";

type ProjectArticle = Article;

const TAB_DESCRIPTIONS: Record<string, string> = {
    extraction: 'Extract structured data using standard templates',
    quality: 'Assess article quality with PROBAST, QUADAS-2, and other risk-of-bias tools',
};

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Use context for project state and navigation
  const { project, setProject: setContextProject, activeTab } = useProject();

    const {isManager} = useProjectMemberRole(
        activeTab === 'extraction' || activeTab === 'quality' ? projectId || '' : '',
    );
    const extractionTab = searchParams.get('extractionTab') as 'extraction' | 'dashboard' | 'configuration' | null;
    const currentExtractionTab = (extractionTab && ['extraction', 'dashboard', 'configuration'].includes(extractionTab))
        ? extractionTab
        : 'extraction';

    const setExtractionTab = (tab: 'extraction' | 'dashboard' | 'configuration') => {
        const next = new URLSearchParams(searchParams);
        next.set('extractionTab', tab);
        setSearchParams(next, {replace: true});
    };

    const qaTab = searchParams.get('qaTab') as
        | 'assessment'
        | 'dashboard'
        | 'configuration'
        | null;
    const currentQaTab = (qaTab && ['assessment', 'dashboard', 'configuration'].includes(qaTab))
        ? qaTab
        : 'assessment';

    const setQaTab = (tab: 'assessment' | 'dashboard' | 'configuration') => {
        const next = new URLSearchParams(searchParams);
        next.set('qaTab', tab);
        setSearchParams(next, {replace: true});
    };

    const [articles, setArticles] = useState<ProjectArticle[]>([]);
  const [loading, setLoading] = useState(true);
  // Generation counter: a project navigation bumps it so an in-flight load for
  // the previous projectId resolves into a no-op instead of overwriting the
  // current project's data (#110).
  const projectLoadRef = useRef(0);
    const [zoteroDialogOpen, setZoteroDialogOpen] = useState(false);
    const [risDialogOpen, setRisDialogOpen] = useState(false);
    const articlesListRef = useRef<ArticlesListHandle>(null);
    const [articlesExportEnabled, setArticlesExportEnabled] = useState(false);
    const {isConfigured: hasZoteroConfigured} = useZoteroIntegration();

    const closeArticleEditor = () => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('articleEditor');
                next.delete('articleId');
                return next;
            },
            {replace: true}
        );
    };

    const openArticleEditorAdd = () => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('tab', 'articles');
                next.set('articleEditor', 'add');
                next.delete('articleId');
                return next;
            },
            {replace: false}
        );
    };

    const openArticleEditorEdit = (articleId: string) => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('tab', 'articles');
                next.set('articleEditor', 'edit');
                next.set('articleId', articleId);
                return next;
            },
            {replace: false}
        );
    };

    useEffect(() => {
        if (activeTab !== 'articles') {
            setSearchParams(
                (prev) => {
                    if (!prev.get('articleEditor') && !prev.get('articleId')) {
                        return prev;
                    }
                    const next = new URLSearchParams(prev);
                    next.delete('articleEditor');
                    next.delete('articleId');
                    return next;
                },
                {replace: true}
            );
        }
    }, [activeTab, setSearchParams]);

    useEffect(() => {
        if (activeTab !== 'articles') {
            return;
        }
        const mode = searchParams.get('articleEditor');
        const id = searchParams.get('articleId');
        if (mode === 'edit' && !id) {
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    next.delete('articleEditor');
                    next.delete('articleId');
                    return next;
                },
                {replace: true}
            );
        }
    }, [activeTab, searchParams, setSearchParams]);

  // New project selected: show the spinner again instead of leaving the old
  // project's data on screen (#110). Adjusted during render so the effect
  // below never calls setState synchronously.
  const [prevProjectId, setPrevProjectId] = useState(projectId);
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId);
    if (projectId) setLoading(true);
  }

  const loadProject = async () => {
    if (!projectId) return;
    // Captured synchronously before the first await; both loaders read the same
    // post-bump value because the effect bumps once before calling them.
    const generation = projectLoadRef.current;
    const result = await loadProjectById(projectId);
    if (generation !== projectLoadRef.current) return;
    if (!result.ok) {
      toast.error("Error loading project");
      console.error(result.error);
    } else {
      setContextProject(result.data);
    }
    setLoading(false);
  };

  const loadArticles = async () => {
    if (!projectId) return;
    const generation = projectLoadRef.current;
    const result = await loadProjectArticles(projectId);
    if (generation !== projectLoadRef.current) return;
    if (!result.ok) {
      console.error(result.error);
      return;
    }
    setArticles(result.data);
  };

  useEffect(() => {
    if (!projectId) return;
    // New project selected: bump the generation so any in-flight load for the
    // previous project resolves into a no-op (#110). The loaders run from a
    // microtask so all their setState calls happen in async callbacks.
    projectLoadRef.current += 1;
    queueMicrotask(() => {
      void loadProject();
      void loadArticles();
    });
    return () => {
      // Invalidate in-flight loads on projectId change / unmount.
      projectLoadRef.current += 1;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
          <p>Project not found</p>
      </div>
    );
  }

    // Render content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'articles':
        return (
            <ArticlesList
                ref={articlesListRef}
                articles={articles}
                onArticleClick={openArticleEditorEdit}
                projectId={projectId || ''}
                onArticlesChange={loadArticles}
                onOpenZoteroDialog={() => setZoteroDialogOpen(true)}
                onOpenRisDialog={() => setRisDialogOpen(true)}
                onExportAvailabilityChange={setArticlesExportEnabled}
                onOpenAddArticle={openArticleEditorAdd}
            />
        );

      case 'extraction':
        return <ExtractionInterface projectId={projectId || ''} />;

      case 'quality':
        return <QualityAssessmentInterface projectId={projectId || ''} />;

      case 'settings':
        return <ProjectSettings projectId={projectId || ''} />;

      case 'overview':
        return <ComingSoonPanel title={t('layout', 'navOverview')} icon={LayoutDashboard} />;

      case 'screening':
        return <ComingSoonPanel title={t('layout', 'navScreening')} icon={ListChecks} />;

      case 'prisma':
        return <ComingSoonPanel title={t('layout', 'navPrismaReport')} icon={FileBarChart} />;

      default:
        return null;
    }
  };

    const articleEditorMode = searchParams.get('articleEditor');
    const editorArticleIdFromUrl = searchParams.get('articleId');
    const articleEditorSheetOpen =
        activeTab === 'articles' &&
        (articleEditorMode === 'add' ||
            (articleEditorMode === 'edit' && Boolean(editorArticleIdFromUrl)));

    // Tabs that render a full-bleed placeholder/page without the articles-style action bar.
    const FULL_BLEED_TABS = new Set(['settings', 'overview', 'screening', 'prisma']);
    const isFullBleed = FULL_BLEED_TABS.has(activeTab);

  return (
      <div className="h-full bg-background flex flex-col">

          {/* Sticky action bar — stack on narrow (flex-col md:flex-row), single row from md */}
        {!isFullBleed && (
            <div
                className="shrink-0 min-h-12 md:h-12 flex flex-col md:flex-row md:items-center md:justify-between items-stretch gap-2 md:gap-0 py-3 md:py-0 border-b border-border/40 bg-background/80 backdrop-blur-sm px-6 lg:px-10">
          <span className="text-[13px] text-muted-foreground/70 w-full min-w-0 md:flex-1 md:truncate">
            {activeTab === 'articles'
                ? 'Articles'
                : (TAB_DESCRIPTIONS[activeTab] ?? '')}
          </span>
                {activeTab === 'extraction' && (
                    <div className="flex items-center gap-0.5 w-full md:w-auto shrink-0" role="tablist"
                         aria-label="Extraction views">
                        {[
                            {value: 'extraction' as const, label: t('extraction', 'tabExtraction')},
                            {value: 'dashboard' as const, label: t('extraction', 'tabDashboard')},
                            ...(isManager ? [{
                                value: 'configuration' as const,
                                label: t('extraction', 'tabConfiguration')
                            }] : []),
                        ].map(({value, label}) => (
                            <Button
                                key={value}
                                variant="ghost"
                                size="sm"
                                className={`h-8 px-3 text-[13px] font-medium rounded-md transition-colors duration-75 ${
                                    currentExtractionTab === value ? 'bg-muted/50 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                }`}
                                onClick={() => setExtractionTab(value)}
                                aria-selected={currentExtractionTab === value}
                                role="tab"
                            >
                                {label}
                            </Button>
                        ))}
                    </div>
                )}
                {activeTab === 'quality' && (
                    <div className="flex items-center gap-0.5 w-full md:w-auto shrink-0" role="tablist"
                         aria-label="Quality assessment views">
                        {[
                            {value: 'assessment' as const, label: t('qa', 'tabAssessment')},
                            {value: 'dashboard' as const, label: t('qa', 'tabDashboard')},
                            ...(isManager ? [{
                                value: 'configuration' as const,
                                label: t('qa', 'tabConfiguration')
                            }] : []),
                        ].map(({value, label}) => (
                            <Button
                                key={value}
                                variant="ghost"
                                size="sm"
                                className={`h-8 px-3 text-[13px] font-medium rounded-md transition-colors duration-75 ${
                                    currentQaTab === value ? 'bg-muted/50 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                }`}
                                onClick={() => setQaTab(value)}
                                aria-selected={currentQaTab === value}
                                role="tab"
                                data-testid={`hitl-quality_assessment-tab-${value}`}
                            >
                                {label}
                            </Button>
                        ))}
                    </div>
                )}
              {activeTab === 'articles' && (
                  <div className="flex items-center gap-1.5 w-full md:w-auto shrink-0 flex-wrap">
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                              <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 gap-1 text-xs font-medium rounded-md border-border/50 hover:bg-muted/50 hover:border-border transition-colors"
                              >
                                  <Upload className="h-3.5 w-3.5 shrink-0"/>
                                  {t('pages', 'projectViewImportArticles')}
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70"/>
                              </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                              align="end"
                              sideOffset={6}
                              className="min-w-[180px] rounded-lg border border-border/50 bg-popover/95 backdrop-blur-sm py-1.5 px-1 shadow-[0_4px_20px_rgba(0,0,0,0.08)]"
                          >
                              <DropdownMenuItem
                                  onClick={() =>
                                      hasZoteroConfigured
                                          ? setZoteroDialogOpen(true)
                                          : navigate('/settings?tab=integrations')
                                  }
                                  className="flex items-center gap-2.5 rounded-md py-2 px-2.5 cursor-pointer focus:bg-muted/60"
                              >
                          <span
                              className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                            <span className="text-[9px] font-semibold text-primary leading-none">Z</span>
                          </span>
                                  From Zotero
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                  onClick={() => setRisDialogOpen(true)}
                                  className="flex items-center gap-2.5 rounded-md py-2 px-2.5 cursor-pointer focus:bg-muted/60"
                              >
                          <span
                              className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center shrink-0 border border-primary/15">
                            <FileText className="h-2.5 w-2.5 text-primary"/>
                          </span>
                                  From RIS file
                              </DropdownMenuItem>
                          </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                          size="sm"
                          variant="outline"
                          disabled={!articlesExportEnabled}
                          onClick={() => articlesListRef.current?.openExportDialog()}
                          className="h-7 px-2 gap-1 text-xs font-medium rounded-md border-border/50 hover:bg-muted/50 hover:border-border transition-colors disabled:opacity-50"
                      >
                          <Download className="h-3.5 w-3.5 shrink-0"/>
                          {t('pages', 'projectViewExportArticles')}
                      </Button>
                      <Button
                          size="sm"
                          onClick={openArticleEditorAdd}
                          className="h-7 px-2.5 gap-1 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
                      >
                          <Plus className="h-3.5 w-3.5 shrink-0"/>
                          {t('pages', 'projectViewAddArticle')}
                      </Button>
                  </div>
              )}
            </div>
        )}

      {isFullBleed ? (
          <div className="flex-1 overflow-y-auto">{renderContent()}</div>
      ) : activeTab === 'extraction' || activeTab === 'quality' ? (
          <div className="flex-1 min-h-0 flex flex-col px-6 py-4 lg:px-10">
              <div className="w-full max-w-[1800px] mx-auto flex flex-1 min-h-0 flex-col">
                  {renderContent()}
              </div>
          </div>
      ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 lg:px-10">
              <div className="w-full max-w-[1800px] mx-auto">
            {renderContent()}
          </div>
        </div>
      )}

          <ZoteroImportDialog
              open={zoteroDialogOpen}
              onOpenChange={setZoteroDialogOpen}
              projectId={projectId || ''}
              onImportComplete={loadArticles}
          />
          <RISImportDialog
              open={risDialogOpen}
              onOpenChange={setRisDialogOpen}
              projectId={projectId || ''}
              onImportComplete={loadArticles}
          />

          <Sheet
              open={articleEditorSheetOpen}
              onOpenChange={(open) => {
                  if (!open) {
                      closeArticleEditor();
                  }
              }}
          >
              <SheetContent
                  side="right"
                  showCloseButton={false}
                  className="flex h-full w-full max-w-full min-h-0 flex-col gap-0 border-l border-border/40 p-0 sm:max-w-none sm:w-[min(960px,96vw)] lg:w-[min(1100px,92vw)]"
              >
                  {articleEditorMode === 'add' && projectId ? (
                      <ArticleForm
                          key="article-editor-add"
                          variant="panel"
                          mode="add"
                          projectId={projectId}
                          onDismiss={closeArticleEditor}
                          onComplete={loadArticles}
                      />
                  ) : null}
                  {articleEditorMode === 'edit' && editorArticleIdFromUrl && projectId ? (
                      <ArticleForm
                          key={editorArticleIdFromUrl}
                          variant="panel"
                          mode="edit"
                          projectId={projectId}
                          articleId={editorArticleIdFromUrl}
                          onDismiss={closeArticleEditor}
                          onComplete={() => {
                              void loadArticles();
                              closeArticleEditor();
                          }}
                      />
                  ) : null}
              </SheetContent>
          </Sheet>
    </div>
  );
}
