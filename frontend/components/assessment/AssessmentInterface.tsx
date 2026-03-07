/**
 * Main interface for article assessment
 *
 * Component that manages the full assessment flow for a project,
 * including instruments, assessments and AI.
 */

import {useEffect, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Skeleton} from "@/components/ui/skeleton";
import {AlertCircle, BarChart3, CheckCircle, FileText, Settings} from "lucide-react";
import {supabase} from "@/integrations/supabase/client";
import {useHasConfiguredInstrument} from "@/hooks/assessment";
import {ArticleAssessmentTable} from "./ArticleAssessmentTable";
import {ConfigureInstrumentFirst} from "./config/ConfigureInstrumentFirst";
import {InstrumentManager} from "./config/InstrumentManager";
import {toast} from "sonner";
import type {Assessment, AssessmentInstrument} from "@/types/assessment";
import type {Article as ArticleRow} from "@/types/article";
import {getAssessmentStatus} from "@/lib/assessment-utils";
import {useCurrentUser} from "@/hooks/useCurrentUser";
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface AssessmentInterfaceProps {
  projectId: string;
}

/** Simplified article for listing */
type ArticleSummary = Pick<ArticleRow, 'id' | 'title' | 'doi' | 'created_at'>;

type AssessmentTab = 'assessment' | 'dashboard' | 'configuration';
const ASSESSMENT_TABS = ['assessment', 'dashboard', 'configuration'] as const;

export const AssessmentInterface = ({ projectId }: AssessmentInterfaceProps) => {
  const [searchParams, setSearchParams] = useSearchParams();

    // Read tab from URL or use default
  const tabFromUrl = searchParams.get('assessmentTab');
  const initialTab: AssessmentTab = ASSESSMENT_TABS.includes(tabFromUrl as AssessmentTab)
    ? (tabFromUrl as AssessmentTab)
    : 'assessment';

  const [activeInstrument, setActiveInstrument] = useState<AssessmentInstrument | null>(null);
  const [activeTab, setActiveTab] = useState<AssessmentTab>(initialTab);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [stats, setStats] = useState({
    totalArticles: 0,
    completedAssessments: 0,
    inProgressAssessments: 0,
    progressPercentage: 0,
  });
  const { user, loading: authLoading } = useCurrentUser();

    // Hook to manage project instruments
  const {
    hasInstrument,
    isLoading: instrumentsLoading,
    instruments: projectInstruments,
  } = useHasConfiguredInstrument(projectId);

    // Load active instrument when project instruments are loaded
  useEffect(() => {
    if (projectInstruments && projectInstruments.length > 0 && !activeInstrument) {
        // Convert ProjectAssessmentInstrument to expected format
      const defaultInstrument = projectInstruments[0];
      setActiveInstrument({
        id: defaultInstrument.id,
        tool_type: defaultInstrument.toolType as AssessmentInstrument['tool_type'],
        name: defaultInstrument.name,
        version: defaultInstrument.version,
        mode: defaultInstrument.mode,
        is_active: defaultInstrument.isActive,
        aggregation_rules: defaultInstrument.aggregationRules,
        schema: defaultInstrument.schema as AssessmentInstrument['schema'],
        created_at: defaultInstrument.createdAt,
      });
    }
  }, [projectInstruments, activeInstrument]);

    // Sync active tab with URL
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('assessmentTab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

    // Change tab and update URL
  const handleTabChange = (tab: AssessmentTab) => {
    setActiveTab(tab);
  };

    // Load articles and assessments
  useEffect(() => {
    if (projectId && activeInstrument) {
      loadArticles();
      loadAssessments();
    }
  }, [projectId, activeInstrument, user, authLoading]);

    // Calculate stats when data changes
  useEffect(() => {
    if (articles.length > 0 && activeInstrument) {
      calculateStats();
    }
  }, [articles, assessments, activeInstrument]);

  const loadArticles = async () => {
    try {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, doi, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error) {
        const message = error instanceof Error ? error.message : t('assessment', 'errorLoadArticles');
      console.error("Error loading articles:", error);
      toast.error(message);
    }
  };

  const loadAssessments = async () => {
    try {
      if (authLoading || !user) return;

      const { data, error } = await supabase
        .from("assessments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .eq("is_current_version", true);

      if (error) throw error;
      setAssessments(data || []);
    } catch (error) {
      console.error("Error loading assessments:", error);
    }
  };

  const calculateStats = () => {
    const assessmentsForInstrument = assessments.filter(
      a => a.instrument_id === activeInstrument?.id
    );
    
    const completed = assessmentsForInstrument.filter((assessment) => {
      const progress = assessment.completion_percentage ?? 0;
      return getAssessmentStatus(assessment.status, progress) === 'complete';
    }).length;

    const inProgress = assessmentsForInstrument.filter((assessment) => {
      const progress = assessment.completion_percentage ?? 0;
      return getAssessmentStatus(assessment.status, progress) === 'in_progress';
    }).length;
    
    const total = articles.length;
    const progressPercentage = total > 0 
      ? Math.round((completed / total) * 100)
      : 0;

    setStats({
      totalArticles: total,
      completedAssessments: completed,
      inProgressAssessments: inProgress,
      progressPercentage,
    });
  };

    // Render Dashboard tab
  const renderDashboard = () => (
      <div className="space-y-4">
          {/* Main statistics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <Card className="border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                      <CardTitle className="text-[13px] font-medium">{t('assessment', 'dashboardArticles')}</CardTitle>
                      <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.5}/>
          </CardHeader>
                  <CardContent className="px-4 pb-4">
                      <div className="text-xl font-bold">{stats.totalArticles}</div>
                      <p className="text-[13px] text-muted-foreground">
                          {t('assessment', 'dashboardInProject')}
            </p>
          </CardContent>
        </Card>

              <Card className="border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                      <CardTitle className="text-[13px] font-medium">{t('assessment', 'dashboardCompleted')}</CardTitle>
                      <CheckCircle className="h-4 w-4 text-muted-foreground" strokeWidth={1.5}/>
          </CardHeader>
                  <CardContent className="px-4 pb-4">
                      <div className="text-xl font-bold">
              {stats.completedAssessments}
              {stats.inProgressAssessments > 0 && (
                  <span className="text-[13px] text-muted-foreground ml-2">
                  (+{stats.inProgressAssessments})
                </span>
              )}
            </div>
                      <p className="text-[13px] text-muted-foreground">
                          {t('assessment', 'dashboardAssessed')}
            </p>
          </CardContent>
        </Card>

              <Card className="border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                      <CardTitle
                          className="text-[13px] font-medium">{t('assessment', 'dashboardOverallProgress')}</CardTitle>
                      <BarChart3 className="h-4 w-4 text-muted-foreground" strokeWidth={1.5}/>
          </CardHeader>
                  <CardContent className="px-4 pb-4">
                      <div className="text-xl font-bold">{stats.progressPercentage}%</div>
                      <p className="text-[13px] text-muted-foreground">
                          {t('assessment', 'dashboardAverageCompleteness')}
            </p>
          </CardContent>
        </Card>
      </div>

          {/* Message when no instrument */}
      {!activeInstrument && !instrumentsLoading && (
          <Card className="border-border/40 border-yellow-200 bg-yellow-50">
              <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center space-x-3">
                <AlertCircle className="h-4 w-4 text-yellow-600" strokeWidth={1.5}/>
              <div>
                  <p className="text-[13px] font-medium text-yellow-900">{t('assessment', 'dashboardNoInstrument')}</p>
                  <p className="text-[13px] text-yellow-700 mt-1">
                      {t('assessment', 'dashboardNoInstrumentDesc')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

    // Render tab content (only when not loading instruments)
  const renderTabContent = () => {
      if (instrumentsLoading) {
          return null; // Loading is shown in TabsContent
      }
    switch (activeTab) {
      case 'assessment':
        return activeInstrument ? (
          <ArticleAssessmentTable
            projectId={projectId}
            instrumentId={activeInstrument.id}
          />
        ) : (
          <ConfigureInstrumentFirst
            projectId={projectId}
            onConfigureClick={() => setActiveTab('configuration')}
          />
        );

      case 'dashboard':
        return renderDashboard();

      case 'configuration':
        return (
            <Card className="border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <CardHeader className="pb-2 px-4 sm:px-6">
                    <CardTitle className="flex items-center gap-2 text-[13px] font-medium">
                        <Settings className="h-4 w-4" strokeWidth={1.5}/>
                        {t('assessment', 'configInstrumentsTitle')}
              </CardTitle>
                    <CardDescription className="text-[13px]">
                        {t('assessment', 'configInstrumentsDesc')}
              </CardDescription>
            </CardHeader>
                <CardContent className="px-4 sm:px-6">
              <InstrumentManager projectId={projectId} />
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
      <div className="space-y-4">
      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (ASSESSMENT_TABS.includes(value as AssessmentTab)) {
            handleTabChange(value as AssessmentTab);
          }
        }}
      >
          <TabsList className="flex flex-wrap gap-1 w-full h-10 text-[13px] border-border/40 p-1">
              <TabsTrigger value="assessment" className="flex-1 min-w-[80px] data-[state=active]:bg-muted/50">
                  {t('assessment', 'tabAssessment')}
          </TabsTrigger>
              <TabsTrigger value="dashboard" disabled={!hasInstrument}
                           className="flex-1 min-w-[80px] data-[state=active]:bg-muted/50">
                  {t('assessment', 'tabDashboard')}
          </TabsTrigger>
              <TabsTrigger value="configuration" className="flex-1 min-w-[80px] data-[state=active]:bg-muted/50">
                  {t('assessment', 'tabConfiguration')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
            {instrumentsLoading ? (
                <div className="space-y-4" aria-busy="true" aria-label={t('assessment', 'loadingInstruments')}>
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-9 flex-1 max-w-sm"/>
                        <Skeleton className="h-4 w-24"/>
                    </div>
                    <div className="rounded-lg border border-border/40">
                        <div className="border-b border-border/40 px-4 py-2 flex gap-4">
                            <Skeleton className="h-4 w-[30%]"/>
                            <Skeleton className="h-4 w-[15%]"/>
                            <Skeleton className="h-4 w-[10%]"/>
                            <Skeleton className="h-4 w-[15%]"/>
                            <Skeleton className="h-4 w-[10%]"/>
                            <Skeleton className="h-4 w-[15%]"/>
                        </div>
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div key={i} className="flex gap-4 px-4 py-2 border-b border-border/40 last:border-b-0">
                                <Skeleton className="h-4 flex-1 max-w-[30%]"/>
                                <Skeleton className="h-4 w-[15%]"/>
                                <Skeleton className="h-4 w-[10%]"/>
                                <Skeleton className="h-4 w-[15%]"/>
                                <Skeleton className="h-4 w-[10%]"/>
                                <Skeleton className="h-8 w-20"/>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                renderTabContent()
            )}
        </TabsContent>
      </Tabs>

      {/* Note: Error handling is done within InstrumentManager component */}
    </div>
  );
};
