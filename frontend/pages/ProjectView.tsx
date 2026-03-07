import {useEffect, useState} from "react";
import {useNavigate, useParams, useSearchParams} from "react-router-dom";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {Plus, ChevronDown, Upload, FileText} from "lucide-react";
import {toast} from "sonner";
import {ArticlesList} from "@/components/articles/ArticlesList";
import {ProjectSettings} from "@/components/project/ProjectSettings";
import {AssessmentInterface} from "@/components/assessment/AssessmentInterface";
import {ExtractionInterface} from "@/components/extraction/ExtractionInterface";
import {ZoteroImportDialog} from "@/components/articles/ZoteroImportDialog";
import {RISImportDialog} from "@/components/articles/RISImportDialog";
import {useProject} from "@/contexts/ProjectContext";
import {useZoteroIntegration} from "@/hooks/useZoteroIntegration";
import {useProjectMemberRole} from "@/hooks/useProjectMemberRole";
import {t} from "@/lib/copy";

interface Article {
  id: string;
  title: string;
  abstract: string | null;
  publication_year: number | null;
  journal_title: string | null;
  authors: string[] | null;
  doi: string | null;
  pmid: string | null;
  keywords: string[] | null;
}

const TAB_DESCRIPTIONS: Record<string, string> = {
    extraction: 'Extract structured data using standard templates',
    assessment: 'Assess methodological quality of articles',
};

export default function ProjectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Use context for project state and navigation
  const { project, setProject: setContextProject, activeTab } = useProject();

    const {isManager} = useProjectMemberRole(activeTab === 'extraction' ? projectId || '' : '');
    const extractionTab = searchParams.get('extractionTab') as 'extraction' | 'dashboard' | 'configuration' | null;
    const currentExtractionTab = (extractionTab && ['extraction', 'dashboard', 'configuration'].includes(extractionTab))
        ? extractionTab
        : 'extraction';

    const setExtractionTab = (tab: 'extraction' | 'dashboard' | 'configuration') => {
        const next = new URLSearchParams(searchParams);
        next.set('extractionTab', tab);
        setSearchParams(next, {replace: true});
    };
  
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
    const [zoteroDialogOpen, setZoteroDialogOpen] = useState(false);
    const [risDialogOpen, setRisDialogOpen] = useState(false);
    const {isConfigured: hasZoteroConfigured} = useZoteroIntegration();

  useEffect(() => {
    if (projectId) {
      loadProject();
      loadArticles();
    }
  }, [projectId]);

  const loadProject = async () => {
    if (!projectId) return;
    
    try {
      const { data, error } = await supabase
        .from("projects")
        .select(`
          id, name, description, review_title, review_type,
          settings, assessment_scope, assessment_entity_type_id,
          condition_studied,
          created_at, updated_at
        `)
        .eq("id", projectId)
        .single();

      if (error) throw error;
      setContextProject(data);
    } catch (error: any) {
        toast.error("Error loading project");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const loadArticles = async () => {
    if (!projectId) return;
    
    try {
      const { data, error } = await supabase
        .from("articles")
        .select(`
          id, title, abstract, authors, publication_year,
          journal_title, doi, pmid, keywords, created_at
        `)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      console.error(error);
    }
  };


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
                articles={articles}
                onArticleClick={(articleId) => navigate(`/projects/${projectId}/articles/${articleId}/edit`)}
                projectId={projectId || ''}
                onArticlesChange={loadArticles}
                onOpenZoteroDialog={() => setZoteroDialogOpen(true)}
                onOpenRisDialog={() => setRisDialogOpen(true)}
            />
        );

      case 'extraction':
        return <ExtractionInterface projectId={projectId || ''} />;

      case 'assessment':
        return <AssessmentInterface projectId={projectId || ''} />;

      case 'settings':
        return <ProjectSettings projectId={projectId || ''} />;

      default:
        return null;
    }
  };

  return (
      <div className="h-full bg-background flex flex-col">

          {/* Sticky action bar — stack on narrow (flex-col md:flex-row), single row from md */}
        {activeTab !== 'settings' && (
            <div
                className="flex-shrink-0 min-h-12 md:h-12 flex flex-col md:flex-row md:items-center md:justify-between items-stretch gap-2 md:gap-0 py-3 md:py-0 border-b border-border/40 bg-background/80 backdrop-blur-sm px-6 lg:px-10">
          <span className="text-[13px] text-muted-foreground/70 w-full min-w-0 md:flex-1 md:truncate">
            {activeTab === 'articles'
                ? 'Articles'
                : (TAB_DESCRIPTIONS[activeTab] ?? '')}
          </span>
                {activeTab === 'extraction' && (
                    <div className="flex items-center gap-0.5 w-full md:w-auto flex-shrink-0" role="tablist"
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
              {activeTab === 'articles' && (
                  <div className="flex items-center gap-2 w-full md:w-auto flex-shrink-0 flex-wrap">
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                              <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-4 text-[13px] font-medium rounded-lg border-border/50 hover:bg-muted/50 hover:border-border transition-colors"
                              >
                                  <Upload className="mr-2 h-4 w-4"/>
                                  Import articles
                                  <ChevronDown className="ml-1.5 h-4 w-4 opacity-70"/>
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
                              className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
                            <span className="text-[9px] font-semibold text-primary leading-none">Z</span>
                          </span>
                                  From Zotero
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                  onClick={() => setRisDialogOpen(true)}
                                  className="flex items-center gap-2.5 rounded-md py-2 px-2.5 cursor-pointer focus:bg-muted/60"
                              >
                          <span
                              className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
                            <FileText className="h-2.5 w-2.5 text-primary"/>
                          </span>
                                  From RIS file
                              </DropdownMenuItem>
                          </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                          size="sm"
                          onClick={() => navigate(`/projects/${projectId}/articles/add`)}
                          className="h-8 px-4 text-[13px] font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
                      >
                          <Plus className="mr-2 h-4 w-4"/>
                          Add article
                      </Button>
                  </div>
              )}
            </div>
        )}

      {activeTab === 'settings' ? (
          <div className="flex-1 overflow-y-auto">{renderContent()}</div>
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
    </div>
  );
}
