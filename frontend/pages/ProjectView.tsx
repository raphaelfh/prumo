import {useEffect, useRef, useState} from "react";
import {useParams, useSearchParams} from "react-router";
import {loadProjectById, loadProjectArticles} from "@/services/projectsService";
import {FileBarChart, LayoutDashboard, ListChecks} from "lucide-react";
import {ComingSoonPanel} from "@/components/layout/ComingSoonPanel";
import {toast} from "sonner";
import {ArticlesList} from "@/components/articles/ArticlesList";
import {ArticlesSplitShell} from "@/components/articles/ArticlesSplitShell";
import {ProjectSettings} from "@/components/project/ProjectSettings";
import {ExtractionInterface} from "@/components/extraction/ExtractionInterface";
import {QualityAssessmentInterface} from "@/components/quality/QualityAssessmentInterface";
import {ZoteroImportDialog} from "@/components/articles/ZoteroImportDialog";
import {RISImportDialog} from "@/components/articles/RISImportDialog";
import {useProject} from "@/contexts/ProjectContext";
import {t} from "@/lib/copy";
import type {Article} from "@/types/article";

type ProjectArticle = Article;

/** Tabs whose content owns the full pane — no page gutter, no max-width wrapper. */
const FULL_BLEED_TABS = new Set(['articles', 'settings', 'overview', 'screening', 'prisma']);

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();

    // Use context for project state and navigation
  const { project, setProject: setContextProject, activeTab } = useProject();

    const [articles, setArticles] = useState<ProjectArticle[]>([]);
  const [loading, setLoading] = useState(true);
  // Generation counter: a project navigation bumps it so an in-flight load for
  // the previous projectId resolves into a no-op instead of overwriting the
  // current project's data (#110).
  const projectLoadRef = useRef(0);
    const [zoteroDialogOpen, setZoteroDialogOpen] = useState(false);
    const [risDialogOpen, setRisDialogOpen] = useState(false);

    const closeArticleEditor = () => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('articleEditor');
                next.delete('articleId');
                next.delete('articleView');
                return next;
            },
            {replace: true}
        );
    };

    const setArticleView = (view: 'details' | 'document') => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('articleView', view);
                return next;
            },
            // replace: toggling the view is not a navigation step — without
            // this, Back walks through every toggle instead of leaving.
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
                    if (!prev.get('articleEditor') && !prev.get('articleId') && !prev.get('articleView')) {
                        return prev;
                    }
                    const next = new URLSearchParams(prev);
                    next.delete('articleEditor');
                    next.delete('articleId');
                    next.delete('articleView');
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
                    next.delete('articleView');
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

    const articleEditorMode = searchParams.get('articleEditor');
    const editorArticleIdFromUrl = searchParams.get('articleId');

    // Render content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'articles':
        return (
            <ArticlesSplitShell
                projectId={projectId || ''}
                mode={
                    articleEditorMode === 'add'
                        ? 'add'
                        : articleEditorMode === 'edit' && editorArticleIdFromUrl
                          ? 'edit'
                          : null
                }
                articleId={editorArticleIdFromUrl}
                view={searchParams.get('articleView') === 'document' ? 'document' : 'details'}
                onViewChange={setArticleView}
                onSelectArticle={openArticleEditorEdit}
                onDismiss={closeArticleEditor}
                onComplete={() => {
                    void loadArticles();
                    closeArticleEditor();
                }}
                list={({onArticleClick, panelOpen, onTogglePanel}) => (
                    <ArticlesList
                        articles={articles}
                        onArticleClick={onArticleClick}
                        projectId={projectId || ''}
                        onArticlesChange={loadArticles}
                        onOpenZoteroDialog={() => setZoteroDialogOpen(true)}
                        onOpenRisDialog={() => setRisDialogOpen(true)}
                        onOpenAddArticle={openArticleEditorAdd}
                        panelOpen={panelOpen}
                        onTogglePanel={onTogglePanel}
                    />
                )}
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

    const isFullBleed = FULL_BLEED_TABS.has(activeTab);

  return (
      <div className="h-full bg-background flex flex-col">
      {isFullBleed ? (
          <div className="flex-1 overflow-y-auto">{renderContent()}</div>
      ) : (
          <div className="flex-1 min-h-0 flex flex-col px-4 py-3 lg:px-6">
              <div className="w-full max-w-[1800px] mx-auto flex flex-1 min-h-0 flex-col">
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
    </div>
  );
}
