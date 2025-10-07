/**
 * Interface principal para extração de dados
 * 
 * Componente que gerencia todo o fluxo de extração de dados
 * para um projeto específico, incluindo templates, instâncias e valores.
 */

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ClipboardCheck, 
  Database, 
  FileText, 
  Brain, 
  Download,
  Settings,
  Plus,
  Users,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { 
  ProjectExtractionTemplate, 
  ExtractionInstance, 
  ExtractedValue,
  ExtractionEntityDisplay 
} from '@/types/extraction';
import { useExtractionTemplates } from '@/hooks/extraction/useExtractionTemplates';
import { useExtractionInstances } from '@/hooks/extraction/useExtractionInstances';
import { useExtractedValues } from '@/hooks/extraction/useExtractedValues';
import { TemplateManager } from './TemplateManager';
import { InstanceEditor } from './InstanceEditor';
import { AISuggestionsPanel } from './AISuggestionsPanel';
import { ExtractionExport } from './ExtractionExport';

interface ExtractionInterfaceProps {
  projectId: string;
}

export function ExtractionInterface({ projectId }: ExtractionInterfaceProps) {
  const [activeTemplate, setActiveTemplate] = useState<ProjectExtractionTemplate | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'extract' | 'ai' | 'export'>('overview');

  // Hooks para gerenciar estado - apenas templates por enquanto
  const { 
    templates, 
    loading: templatesLoading, 
    error: templatesError,
    cloneTemplate,
    createCustomTemplate 
  } = useExtractionTemplates({ projectId });

  // Placeholder para outros hooks - serão carregados quando necessário
  const instances: any[] = [];
  const values: any[] = [];
  const instancesLoading = false;
  const valuesLoading = false;
  const instancesError = null;
  const valuesError = null;

  // Placeholder functions
  const createInstance = async () => null;
  const updateInstance = async () => null;
  const deleteInstance = async () => false;
  const saveValue = async () => null;
  const updateValue = async () => null;
  const deleteValue = async () => false;

  // Carregar template ativo quando templates são carregados
  useEffect(() => {
    if (templates.length > 0 && !activeTemplate) {
      const defaultTemplate = templates.find(t => t.is_active) || templates[0];
      setActiveTemplate(defaultTemplate);
    }
  }, [templates]); // Removido activeTemplate da dependência para evitar loops

  // Verificar se há template disponível
  useEffect(() => {
    if (templates.length === 0 && !templatesLoading) {
      toast.info('Nenhum template de extração encontrado. Clone um template padrão para começar.');
    }
  }, [templates, templatesLoading]);

  // Calcular estatísticas
  const getStatistics = () => {
    if (!activeTemplate || !selectedArticleId) {
      return {
        totalInstances: 0,
        completedInstances: 0,
        totalFields: 0,
        completedFields: 0,
        completionPercentage: 0
      };
    }

    const totalInstances = instances.length;
    const completedInstances = instances.filter(instance => {
      // Lógica para determinar se uma instância está completa
      return true; // Placeholder
    }).length;

    const totalFields = instances.length * 5; // Placeholder - deveria contar campos reais
    const completedFields = values.length;
    const completionPercentage = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 0;

    return {
      totalInstances,
      completedInstances,
      totalFields,
      completedFields,
      completionPercentage
    };
  };

  const stats = getStatistics();

  // Renderizar conteúdo da aba overview
  const renderOverview = () => (
    <div className="space-y-6">
      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Template Ativo</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeTemplate?.name || 'Nenhum'}
            </div>
            <p className="text-xs text-muted-foreground">
              {activeTemplate?.framework || ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Instâncias</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.completedInstances}/{stats.totalInstances}
            </div>
            <p className="text-xs text-muted-foreground">
              instâncias criadas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Campos Preenchidos</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.completedFields}/{stats.totalFields}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.completionPercentage}% completo
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Badge variant={stats.completionPercentage >= 80 ? 'default' : 'secondary'}>
                {stats.completionPercentage >= 80 ? 'Quase Pronto' : 'Em Progresso'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              último update hoje
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Ações rápidas */}
      <Card>
        <CardHeader>
          <CardTitle>Ações Rápidas</CardTitle>
          <CardDescription>
            Gerencie templates e inicie extrações
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button 
              onClick={() => setActiveTab('extract')}
              disabled={!activeTemplate}
              className="h-auto p-4 flex flex-col items-start space-y-2"
            >
              <Plus className="h-5 w-5" />
              <div className="text-left">
                <div className="font-medium">Iniciar Extração</div>
                <div className="text-sm opacity-80">
                  Comece a extrair dados dos artigos
                </div>
              </div>
            </Button>

            <Button 
              onClick={() => setActiveTab('ai')}
              variant="outline"
              disabled={!activeTemplate}
              className="h-auto p-4 flex flex-col items-start space-y-2"
            >
              <Brain className="h-5 w-5" />
              <div className="text-left">
                <div className="font-medium">Sugestões IA</div>
                <div className="text-sm opacity-80">
                  Use IA para acelerar a extração
                </div>
              </div>
            </Button>

            <Button 
              onClick={() => setActiveTab('export')}
              variant="outline"
              disabled={!activeTemplate || stats.completedFields === 0}
              className="h-auto p-4 flex flex-col items-start space-y-2"
            >
              <Download className="h-5 w-5" />
              <div className="text-left">
                <div className="font-medium">Exportar Dados</div>
                <div className="text-sm opacity-80">
                  Baixe os dados extraídos
                </div>
              </div>
            </Button>

            <Button 
              onClick={() => setActiveTab('templates')}
              variant="outline"
              className="h-auto p-4 flex flex-col items-start space-y-2"
            >
              <Settings className="h-5 w-5" />
              <div className="text-left">
                <div className="font-medium">Gerenciar Templates</div>
                <div className="text-sm opacity-80">
                  Configure templates de extração
                </div>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Template atual */}
      {activeTemplate && (
        <Card>
          <CardHeader>
            <CardTitle>Template Ativo</CardTitle>
            <CardDescription>
              Configurações do template em uso
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{activeTemplate.name}</span>
                <Badge variant="outline">{activeTemplate.framework}</Badge>
              </div>
              {activeTemplate.description && (
                <p className="text-sm text-muted-foreground">
                  {activeTemplate.description}
                </p>
              )}
              <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                <span>Versão: {activeTemplate.version}</span>
                <span>•</span>
                <span>Criado em: {new Date(activeTemplate.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // Renderizar conteúdo das outras abas
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverview();
      
      case 'extract':
        return (
          <InstanceEditor
            projectId={projectId}
            template={activeTemplate}
            instances={instances}
            values={values}
            onInstanceCreate={createInstance}
            onInstanceUpdate={updateInstance}
            onInstanceDelete={deleteInstance}
            onValueSave={saveValue}
            onValueUpdate={updateValue}
            onValueDelete={deleteValue}
            loading={instancesLoading || valuesLoading}
          />
        );
      
      case 'ai':
        return (
          <AISuggestionsPanel
            projectId={projectId}
            articleId={selectedArticleId}
            template={activeTemplate}
            instances={instances}
            values={values}
          />
        );
      
      case 'export':
        return (
          <ExtractionExport
            projectId={projectId}
            template={activeTemplate}
            instances={instances}
            values={values}
          />
        );
      
      case 'templates':
        return (
          <TemplateManager
            projectId={projectId}
            templates={templates}
            activeTemplate={activeTemplate}
            onTemplateSelect={setActiveTemplate}
            onTemplateClone={cloneTemplate}
            onTemplateCreate={createCustomTemplate}
            loading={templatesLoading}
          />
        );
      
      default:
        return renderOverview();
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
        <div className="flex items-center space-x-2">
          <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
          <Badge variant="outline">
            {activeTemplate?.framework || 'Sem Template'}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="extract" disabled={!activeTemplate}>
            Extração
          </TabsTrigger>
          <TabsTrigger value="ai" disabled={!activeTemplate}>
            IA
          </TabsTrigger>
          <TabsTrigger value="export" disabled={!activeTemplate}>
            Exportar
          </TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {renderTabContent()}
        </TabsContent>
      </Tabs>

      {/* Loading state */}
      {(templatesLoading || instancesLoading || valuesLoading) && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando dados de extração...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {(templatesError || instancesError || valuesError) && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Erro ao carregar dados</p>
                <p className="text-sm">
                  {templatesError || instancesError || valuesError}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
