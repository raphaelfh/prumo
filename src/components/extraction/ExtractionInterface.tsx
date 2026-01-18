/**
 * Interface principal para extração de dados
 * 
 * Componente que gerencia todo o fluxo de extração de dados
 * para um projeto específico, incluindo templates, instâncias e valores.
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, 
  Download,
  CheckCircle,
  AlertCircle,
  Settings,
  PlusCircle
} from 'lucide-react';
import { ProjectExtractionTemplate } from '@/types/extraction';
import { useExtractionTemplates } from '@/hooks/extraction/useExtractionTemplates';
import { ArticleExtractionTable } from './ArticleExtractionTable';
import { TemplateConfigEditor } from './TemplateConfigEditor';
import { useAuth } from '@/contexts/AuthContext';
import { ImportTemplateDialog, CreateCustomTemplateDialog } from './dialogs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ExtractionInterfaceProps {
  projectId: string;
}

export function ExtractionInterface({ projectId }: ExtractionInterfaceProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Ler aba da URL ou usar padrão
  const tabFromUrl = searchParams.get('extractionTab') as 'extraction' | 'dashboard' | 'configuration' | null;
  const initialTab = (tabFromUrl && ['extraction', 'dashboard', 'configuration'].includes(tabFromUrl)) 
    ? tabFromUrl 
    : 'extraction';
  
  const [activeTemplate, setActiveTemplate] = useState<ProjectExtractionTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'extraction' | 'dashboard' | 'configuration'>(initialTab);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showCreateCustomDialog, setShowCreateCustomDialog] = useState(false);
  const [articles, setArticles] = useState<any[]>([]);
  const [extractionStats, setExtractionStats] = useState({
    totalArticles: 0,
    extractionsStarted: 0,
    extractionsCompleted: 0,
    progressPercentage: 0,
  });

  // Hook para gerenciar templates
  const { 
    templates, 
    loading: templatesLoading, 
    error: templatesError,
    refreshTemplates
  } = useExtractionTemplates({ projectId });

  // Carregar template ativo quando templates são carregados
  useEffect(() => {
    if (templates.length > 0) {
      if (!activeTemplate) {
        // Se não há template ativo, selecionar o padrão
        const defaultTemplate = templates.find(t => t.is_active) || templates[0];
        setActiveTemplate(defaultTemplate);
      } else {
        // Verificar se o template ativo ainda existe na lista
        const currentTemplate = templates.find(t => t.id === activeTemplate.id);
        if (!currentTemplate) {
          // Template foi removido ou recriado, pegar o mais recente
          const defaultTemplate = templates.find(t => t.is_active) || templates[0];
          if (defaultTemplate) {
            setActiveTemplate(defaultTemplate);
          }
        }
      }
    }
  }, [templates]);

  // Sincronizar aba ativa com URL
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('extractionTab', activeTab);
    setSearchParams(newParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  // Função para mudar aba e atualizar URL
  const handleTabChange = (tab: 'extraction' | 'dashboard' | 'configuration') => {
    setActiveTab(tab);
  };

  // Carregar artigos e estatísticas
  useEffect(() => {
    if (projectId) {
      loadArticles();
    }
  }, [projectId]);

  // Carregar estatísticas quando artigos ou template mudam
  useEffect(() => {
    if (articles.length > 0 && activeTemplate && user) {
      loadExtractionStats();
    }
  }, [articles, activeTemplate, user]);


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

  const loadExtractionStats = async () => {
    if (!activeTemplate || !user) return;

    try {
      // Buscar instâncias de extração para o template ativo
      const { data: instances, error: instancesError } = await supabase
        .from("extraction_instances" as any)
        .select("article_id")
        .eq("project_id", projectId)
        .eq("template_id", activeTemplate.id);

      if (instancesError) throw instancesError;

      // Buscar valores extraídos pelo usuário logado
      const { data: extractedValues, error: valuesError } = await supabase
        .from("extracted_values" as any)
        .select(`
          instance_id,
          extraction_instances!inner(article_id, template_id)
        `)
        .eq("extraction_instances.project_id", projectId)
        .eq("extraction_instances.template_id", activeTemplate.id)
        .eq("reviewer_id", user.id);

      if (valuesError) throw valuesError;

      // Calcular estatísticas
      const totalArticles = articles.length;
      const articlesWithInstances = new Set(instances?.map((i: any) => i.article_id) || []);
      const extractionsStarted = articlesWithInstances.size;
      
      // Contar artigos com extração completa (pelo menos uma instância com valores)
      const articlesWithValues = new Set(extractedValues?.map((v: any) => v.extraction_instances?.article_id).filter(Boolean) || []);
      const extractionsCompleted = articlesWithValues.size;
      
      const progressPercentage = totalArticles > 0 
        ? Math.round((extractionsCompleted / totalArticles) * 100)
        : 0;

      setExtractionStats({
        totalArticles,
        extractionsStarted,
        extractionsCompleted,
        progressPercentage,
      });
    } catch (error: any) {
      console.error("Error loading extraction stats:", error);
      toast.error("Erro ao carregar estatísticas de extração");
    }
  };

  // Renderizar aba Dashboard
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Estatísticas Principais - Layout Minimalista */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artigos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{extractionStats.totalArticles}</div>
            <p className="text-xs text-muted-foreground">
              no projeto
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Extrações Iniciadas</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {extractionStats.extractionsStarted}
              {extractionStats.extractionsCompleted > 0 && (
                <span className="text-sm text-muted-foreground ml-2">
                  ({extractionStats.extractionsCompleted} completas)
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              artigos em extração
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Progresso Geral</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{extractionStats.progressPercentage}%</div>
            <p className="text-xs text-muted-foreground">
              completude média
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mensagem se não houver template */}
      {!activeTemplate && !templatesLoading && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <Settings className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-900">Configure seu template de extração</p>
                  <p className="text-sm text-blue-700 mt-1">
                    Para começar a extrair dados, você precisa configurar as variáveis que serão coletadas.
                  </p>
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-blue-800 font-medium">Você pode:</p>
                    <ul className="text-sm text-blue-700 space-y-1 ml-4">
                      <li>• Importar o template CHARMS (checklist oficial)</li>
                      <li>• Criar suas próprias seções e campos personalizados</li>
                    </ul>
                  </div>
                </div>
              </div>
              <Button 
                onClick={() => setActiveTab('configuration')}
                className="ml-4"
              >
                <Settings className="h-4 w-4 mr-2" />
                Configurar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // Renderizar conteúdo das abas
  const renderTabContent = () => {
    switch (activeTab) {
      case 'extraction':
        return activeTemplate ? (
          <ArticleExtractionTable 
            projectId={projectId} 
            templateId={activeTemplate.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Configure o template primeiro</CardTitle>
              <CardDescription>
                Você precisa configurar as variáveis que serão extraídas dos artigos.
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
                    <p className="font-medium text-sm">Importar template CHARMS</p>
                    <p className="text-sm text-muted-foreground">
                      Use o checklist oficial para revisões de modelos preditivos
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <PlusCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Criar seções personalizadas</p>
                    <p className="text-sm text-muted-foreground">
                      Defina suas próprias variáveis de extração
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
      
      case 'dashboard':
        return renderDashboard();
      
      case 'configuration':
        return activeTemplate ? (
          <TemplateConfigEditor
            projectId={projectId}
            templateId={activeTemplate.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Configure seu template de extração</CardTitle>
              <CardDescription>
                Escolha como você deseja estruturar a extração de dados dos artigos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Opção 1: Importar Template Global */}
              <div className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center space-x-2">
                      <Download className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold">Importar Template CHARMS</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Use o checklist oficial para revisões sistemáticas de modelos preditivos. 
                      Inclui 11 seções e 45 campos pré-configurados seguindo as diretrizes CHARMS.
                    </p>
                  </div>
                  <Button onClick={() => setShowImportDialog(true)} className="ml-4">
                    <Download className="h-4 w-4 mr-2" />
                    Importar
                  </Button>
                </div>
              </div>

              {/* Opção 2: Criar Custom */}
              <div className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center space-x-2">
                      <PlusCircle className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold">Criar Template Personalizado</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Defina suas próprias seções e campos de extração. Ideal para revisões 
                      com necessidades específicas ou frameworks diferentes.
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    className="ml-4"
                    onClick={() => setShowCreateCustomDialog(true)}
                  >
                    <PlusCircle className="h-4 w-4 mr-2" />
                    Criar Template
                  </Button>
                </div>
              </div>

              {/* Nota informativa */}
              <div className="bg-blue-50 border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Managers podem configurar templates</p>
                    <p className="text-blue-700">
                      Se você não é manager do projeto, solicite que um manager configure 
                      o template de extração antes de começar.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      
      default:
        return activeTemplate ? (
          <ArticleExtractionTable 
            projectId={projectId} 
            templateId={activeTemplate.id}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Configure o template primeiro</CardTitle>
              <CardDescription>
                Você precisa configurar as variáveis que serão extraídas dos artigos.
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
                    <p className="font-medium text-sm">Importar template CHARMS</p>
                    <p className="text-sm text-muted-foreground">
                      Use o checklist oficial para revisões de modelos preditivos
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <PlusCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Criar seções personalizadas</p>
                    <p className="text-sm text-muted-foreground">
                      Defina suas próprias variáveis de extração
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
          <h2 className="text-2xl font-semibold">Extração de Dados</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Extraia dados estruturados dos artigos usando templates padronizados
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="extraction" disabled={!activeTemplate}>
            Extração
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
      {templatesLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando templates...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {templatesError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Erro ao carregar templates</p>
                <p className="text-sm">{templatesError}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog para importar template global */}
      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onTemplateImported={async (templateId?: string) => {
          // Recarregar templates sem recarregar a página
          const updatedTemplates = await refreshTemplates() || [];
          // Manter na aba de configuração
          handleTabChange('configuration');
          // Selecionar o template recém-importado
          if (templateId && updatedTemplates.length > 0) {
            const newTemplate = updatedTemplates.find((t: ProjectExtractionTemplate) => t.id === templateId);
            if (newTemplate) {
              setActiveTemplate(newTemplate);
            } else {
              // Se não encontrou pelo ID, seleciona o mais recente
              setActiveTemplate(updatedTemplates[0]);
            }
          } else if (updatedTemplates.length > 0) {
            // Seleciona o mais recente se não tiver ID
            setActiveTemplate(updatedTemplates[0]);
          }
        }}
      />

      {/* Dialog para criar template personalizado */}
      <CreateCustomTemplateDialog
        projectId={projectId}
        open={showCreateCustomDialog}
        onOpenChange={setShowCreateCustomDialog}
        onTemplateCreated={async (templateId?: string) => {
          // Recarregar templates sem recarregar a página
          const updatedTemplates = await refreshTemplates() || [];
          // Manter na aba de configuração
          handleTabChange('configuration');
          // Selecionar o template recém-criado
          if (templateId && updatedTemplates.length > 0) {
            const newTemplate = updatedTemplates.find((t: ProjectExtractionTemplate) => t.id === templateId);
            if (newTemplate) {
              setActiveTemplate(newTemplate);
            } else {
              // Se não encontrou pelo ID, seleciona o mais recente
              setActiveTemplate(updatedTemplates[0]);
            }
          } else if (updatedTemplates.length > 0) {
            // Seleciona o mais recente se não tiver ID
            setActiveTemplate(updatedTemplates[0]);
          }
        }}
      />
    </div>
  );
}
