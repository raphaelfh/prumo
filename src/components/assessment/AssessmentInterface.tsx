/**
 * Interface principal para avaliação de artigos
 * 
 * Componente que gerencia todo o fluxo de avaliação de artigos
 * para um projeto específico, incluindo instrumentos, avaliações e IA.
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Download,
  CheckCircle,
  AlertCircle,
  BarChart3,
  Settings
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAssessmentInstruments } from "@/hooks/assessment/useAssessmentInstruments";
import { ArticleAssessmentTable } from "./ArticleAssessmentTable";
import { toast } from "sonner";

interface AssessmentInterfaceProps {
  projectId: string;
}

export const AssessmentInterface = ({ projectId }: AssessmentInterfaceProps) => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Ler aba da URL ou usar padrão
  const tabFromUrl = searchParams.get('assessmentTab') as 'assessment' | 'dashboard' | 'configuration' | null;
  const initialTab = (tabFromUrl && ['assessment', 'dashboard', 'configuration'].includes(tabFromUrl))
    ? tabFromUrl
    : 'assessment';

  const [activeInstrument, setActiveInstrument] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'assessment' | 'dashboard' | 'configuration'>(initialTab);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [articles, setArticles] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalArticles: 0,
    completedAssessments: 0,
    inProgressAssessments: 0,
    progressPercentage: 0,
  });

  // Hook para gerenciar instrumentos
  const {
    instruments,
    loading: instrumentsLoading,
    error: instrumentsError
  } = useAssessmentInstruments();

  // Carregar instrumento ativo quando instrumentos são carregados
  useEffect(() => {
    if (instruments.length > 0 && !activeInstrument) {
      const defaultInstrument = instruments[0];
      setActiveInstrument(defaultInstrument);
    }
  }, [instruments]);

  // Sincronizar aba ativa com URL
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('assessmentTab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  // Função para mudar aba e atualizar URL
  const handleTabChange = (tab: 'assessment' | 'dashboard' | 'configuration') => {
    setActiveTab(tab);
  };

  // Carregar artigos e avaliações
  useEffect(() => {
    if (projectId && activeInstrument) {
      loadArticles();
      loadAssessments();
    }
  }, [projectId, activeInstrument]);

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
    } catch (error: any) {
      console.error("Error loading articles:", error);
      toast.error("Erro ao carregar artigos");
    }
  };

  const loadAssessments = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("assessments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .eq("is_current_version", true);

      if (error) throw error;
      setAssessments(data || []);
    } catch (error: any) {
      console.error("Error loading assessments:", error);
    }
  };

  const calculateStats = () => {
    const assessmentsForInstrument = assessments.filter(
      a => a.instrument_id === activeInstrument?.id
    );
    
    const completed = assessmentsForInstrument.filter(
      a => a.status === 'submitted' || a.completion_percentage === 100
    ).length;
    
    const inProgress = assessmentsForInstrument.filter(
      a => a.status === 'in_progress' && a.completion_percentage > 0 && a.completion_percentage < 100
    ).length;
    
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
          <Card>
            <CardHeader>
              <CardTitle>Configure o instrumento primeiro</CardTitle>
              <CardDescription>
                Você precisa configurar o instrumento de avaliação que será usado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Vá para a aba <strong>Configuração</strong> e escolha um instrumento de avaliação padronizado.
              </p>
              <Button
                onClick={() => setActiveTab('configuration')}
                className="w-full"
              >
                <Settings className="h-4 w-4 mr-2" />
                Ir para Configuração
              </Button>
            </CardContent>
          </Card>
        );

      case 'dashboard':
        return renderDashboard();

      case 'configuration':
        return activeInstrument ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuração de Instrumentos
              </CardTitle>
              <CardDescription>
                Gerencie instrumentos de avaliação do projeto
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="font-medium mb-2">Instrumento Ativo</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  {activeInstrument.name} - {activeInstrument.tool_type}
                </p>
                <p className="text-sm text-muted-foreground">
                  A configuração de instrumentos será implementada em breve
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Configure seu instrumento de avaliação</CardTitle>
              <CardDescription>
                Escolha qual instrumento padronizado usar para avaliar a qualidade dos estudos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Opção 1: Importar Instrumento Global */}
              <div className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center space-x-2">
                      <Download className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold">Importar Instrumento PROBAST</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Use o instrumento oficial para avaliar risco de viés em modelos de predição.
                      Inclui 4 domínios e 20 itens pré-configurados seguindo as diretrizes PROBAST.
                    </p>
                  </div>
                  <Button onClick={() => setShowImportDialog(true)} className="ml-4">
                    <Download className="h-4 w-4 mr-2" />
                    Importar
                  </Button>
                </div>
              </div>

              {/* Nota informativa */}
              <div className="bg-blue-50 border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Managers podem configurar instrumentos</p>
                    <p className="text-blue-700">
                      Se você não é manager do projeto, solicite que um manager configure
                      o instrumento de avaliação antes de começar.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );

      default:
        return activeInstrument ? (
          <ArticleAssessmentTable
            projectId={projectId}
            instrumentId={activeInstrument.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Configure o instrumento primeiro</CardTitle>
              <CardDescription>
                Você precisa configurar o instrumento de avaliação que será usado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Vá para a aba <strong>Configuração</strong> e escolha:
              </p>
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex items-start space-x-3">
                  <Download className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Importar instrumento PROBAST</p>
                    <p className="text-sm text-muted-foreground">
                      Use o instrumento oficial para avaliação de modelos preditivos
                    </p>
                  </div>
                </div>
              </div>
              <Button
                onClick={() => setActiveTab('configuration')}
                className="w-full"
              >
                <Settings className="h-4 w-4 mr-2" />
                Ir para Configuração
              </Button>
            </CardContent>
          </Card>
        );
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
      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="assessment" disabled={!activeInstrument}>
            Avaliação
          </TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="configuration">
            Configuração
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

      {/* Error state */}
      {instrumentsError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Erro ao carregar instrumentos</p>
                <p className="text-sm">{instrumentsError}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TODO: Implementar Import Dialog para instrumentos globais */}
      {/* Similar ao ImportTemplateDialog do módulo de extração */}
    </div>
  );
};
