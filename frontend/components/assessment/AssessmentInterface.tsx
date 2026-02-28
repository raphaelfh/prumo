/**
 * Interface principal para avaliação de artigos
 * 
 * Componente que gerencia todo o fluxo de avaliação de artigos
 * para um projeto específico, incluindo instrumentos, avaliações e IA.
 */

import {useEffect, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
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

// =================== INTERFACES ===================

interface AssessmentInterfaceProps {
  projectId: string;
}

/** Artigo simplificado para listagem */
type ArticleSummary = Pick<ArticleRow, 'id' | 'title' | 'doi' | 'created_at'>;

type AssessmentTab = 'assessment' | 'dashboard' | 'configuration';
const ASSESSMENT_TABS = ['assessment', 'dashboard', 'configuration'] as const;

export const AssessmentInterface = ({ projectId }: AssessmentInterfaceProps) => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Ler aba da URL ou usar padrão
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

  // Hook para gerenciar instrumentos de projeto
  const {
    hasInstrument,
    isLoading: instrumentsLoading,
    instruments: projectInstruments,
  } = useHasConfiguredInstrument(projectId);

  // Carregar instrumento ativo quando instrumentos de projeto sao carregados
  useEffect(() => {
    if (projectInstruments && projectInstruments.length > 0 && !activeInstrument) {
      // Converter ProjectAssessmentInstrument para o formato esperado
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

  // Sincronizar aba ativa com URL
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('assessmentTab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  // Função para mudar aba e atualizar URL
  const handleTabChange = (tab: AssessmentTab) => {
    setActiveTab(tab);
  };

  // Carregar artigos e avaliações
  useEffect(() => {
    if (projectId && activeInstrument) {
      loadArticles();
      loadAssessments();
    }
  }, [projectId, activeInstrument, user, authLoading]);

  // Calcular estatísticas quando dados mudam
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
      const message = error instanceof Error ? error.message : "Erro ao carregar artigos";
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

  // Renderizar aba Dashboard
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Estatísticas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artigos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalArticles}</div>
            <p className="text-xs text-muted-foreground">
              no projeto
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avaliações Completas</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.completedAssessments}
              {stats.inProgressAssessments > 0 && (
                <span className="text-sm text-muted-foreground ml-2">
                  (+{stats.inProgressAssessments})
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              artigos avaliados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Progresso Geral</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.progressPercentage}%</div>
            <p className="text-xs text-muted-foreground">
              completude média
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mensagem se não houver instrumento */}
      {!activeInstrument && !instrumentsLoading && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-3">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-900">Nenhum instrumento configurado</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Configure um instrumento de avaliação nas configurações do projeto.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // Renderizar conteúdo das abas
  const renderTabContent = () => {
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuracao de Instrumentos
              </CardTitle>
              <CardDescription>
                Gerencie instrumentos de avaliacao do projeto
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InstrumentManager projectId={projectId} />
            </CardContent>
          </Card>
        );

      default:
        // Fallback para tab assessment
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Avaliação de Qualidade</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Avalie a qualidade metodológica dos artigos usando instrumentos padronizados
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (ASSESSMENT_TABS.includes(value as AssessmentTab)) {
            handleTabChange(value as AssessmentTab);
          }
        }}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="assessment">
            Avaliacao
          </TabsTrigger>
          <TabsTrigger value="dashboard" disabled={!hasInstrument}>
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="configuration">
            Configuracao
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {renderTabContent()}
        </TabsContent>
      </Tabs>

      {/* Loading state */}
      {instrumentsLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando instrumentos...</p>
          </div>
        </div>
      )}

      {/* Note: Error handling is done within InstrumentManager component */}
    </div>
  );
};
