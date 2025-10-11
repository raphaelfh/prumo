import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Settings, 
  Loader2, 
  Cpu, 
  Thermometer, 
  Zap, 
  FileSearch,
  Info,
  Save,
  RotateCcw,
  Clock,
  Layers,
  Play,
  FileText,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AssessmentItem } from '@/hooks/assessment/useAssessmentInstruments';

interface AIGlobalConfig {
  // Configurações de processamento
  parallelMode: boolean;
  concurrency: number;
  delayBetweenBatches: number;
  
  // Configurações de IA
  model: string;
  temperature: number;
  maxTokens: number;
  forceFileSearch: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
}

interface Article {
  id: string;
  title: string;
  status?: string;
  completion_percentage?: number;
}

interface AIAssessmentConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  instrumentId: string;
  articles: Article[];
  assessmentItems: AssessmentItem[];
  onStartBatchProcessing: (config: {
    config: AIGlobalConfig;
    selectedArticles: string[];
    selectedItems: string[];
  }) => void;
}

const DEFAULT_CONFIG: AIGlobalConfig = {
  // Processamento
  parallelMode: false,
  concurrency: 3,
  delayBetweenBatches: 1000,
  
  // IA
  model: 'gpt-4o-mini',
  temperature: 0.0,
  maxTokens: 2000,
  forceFileSearch: false,
  systemPrompt: 'You are an expert research quality assessor. Analyze the provided research article and answer the specific question based on the evidence found in the text.',
  userPromptTemplate: 'Based on the article content, assess: {{question}}\n\nAvailable response levels: {{levels}}\n\nProject Context:\n- Review Title: {{review_title}}\n- Condition Studied: {{condition_studied}}\n- Study Design: {{study_design}}\n\nProvide your assessment with clear justification and cite specific passages from the text that support your conclusion.'
};

export const AIAssessmentConfigModal = ({
  open,
  onOpenChange,
  projectId,
  instrumentId,
  articles,
  assessmentItems,
  onStartBatchProcessing
}: AIAssessmentConfigModalProps) => {
  const [config, setConfig] = useState<AIGlobalConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedArticles, setSelectedArticles] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [projectData, setProjectData] = useState<ProjectConfigData | null>(null);
  const [selectedItem, setSelectedItem] = useState<AssessmentItem | null>(null);
  const [itemConfig, setItemConfig] = useState<{ systemPrompt: string; userPromptTemplate: string }>({
    systemPrompt: DEFAULT_CONFIG.systemPrompt,
    userPromptTemplate: DEFAULT_CONFIG.userPromptTemplate
  });
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      loadConfiguration();
      loadProjectData();
      // Auto-selecionar todos os artigos e itens por padrão
      setSelectedArticles(articles.map(article => article.id));
      setSelectedItems(assessmentItems.map(item => item.id));
    }
  }, [open, projectId, articles, assessmentItems]);

  const loadConfiguration = async () => {
    setLoading(true);
    try {
      // Carregar configurações globais do localStorage
      const savedConfig = localStorage.getItem('ai-global-config');
      if (savedConfig) {
        const parsedConfig = JSON.parse(savedConfig);
        setConfig(prev => ({ ...prev, ...parsedConfig }));
      }
    } catch (error) {
      console.error('Error loading global configuration:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectData = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('description, review_title, condition_studied, eligibility_criteria, study_design')
        .eq('id', projectId)
        .single();

      if (error) throw error;
      setProjectData(data);
    } catch (error) {
      console.error('Error loading project data:', error);
    }
  };

  const loadItemConfiguration = async (item: AssessmentItem) => {
    try {
      const { data, error } = await supabase
        .from('ai_assessment_prompts')
        .select('*')
        .eq('assessment_item_id', item.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setItemConfig({
          systemPrompt: data.system_prompt,
          userPromptTemplate: data.user_prompt_template
        });
      } else {
        setItemConfig({
          systemPrompt: config.systemPrompt,
          userPromptTemplate: config.userPromptTemplate
        });
      }
    } catch (error) {
      console.error('Error loading item configuration:', error);
    }
  };

  const handleConfigChange = (updates: Partial<AIGlobalConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Salvar configurações globais no localStorage
      localStorage.setItem('ai-global-config', JSON.stringify(config));
      
      toast({
        title: "Configuração salva",
        description: "Configurações globais de IA atualizadas com sucesso",
      });
    } catch (error) {
      console.error('Error saving global configuration:', error);
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveItemConfig = async () => {
    if (!selectedItem) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('ai_assessment_prompts')
        .upsert({
          assessment_item_id: selectedItem.id,
          system_prompt: itemConfig.systemPrompt,
          user_prompt_template: itemConfig.userPromptTemplate,
        }, {
          onConflict: 'assessment_item_id'
        });

      if (error) throw error;

      toast({
        title: "Configuração salva",
        description: `Configurações da questão "${selectedItem.question}" atualizadas`,
      });
    } catch (error) {
      console.error('Error saving item configuration:', error);
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    toast({
      title: "Configuração resetada",
      description: "Configurações restauradas para os valores padrão",
    });
  };

  const handleSelectAllArticles = () => {
    if (selectedArticles.length === articles.length) {
      setSelectedArticles([]);
    } else {
      setSelectedArticles(articles.map(article => article.id));
    }
  };

  const handleSelectAllItems = () => {
    if (selectedItems.length === assessmentItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(assessmentItems.map(item => item.id));
    }
  };

  const handleStartProcessing = () => {
    if (selectedArticles.length === 0) {
      toast({
        title: "Seleção necessária",
        description: "Selecione pelo menos um artigo para processar",
        variant: "destructive",
      });
      return;
    }

    if (selectedItems.length === 0) {
      toast({
        title: "Seleção necessária",
        description: "Selecione pelo menos uma questão para avaliar",
        variant: "destructive",
      });
      return;
    }

    onStartBatchProcessing({
      config,
      selectedArticles,
      selectedItems
    });
    
    onOpenChange(false);
  };

  const getTokenCost = (tokens: number, model: string) => {
    const costs = {
      'gpt-4o': 0.005,
      'gpt-4o-mini': 0.00015,
      'gpt-4-turbo': 0.01,
    };
    const cost = costs[model as keyof typeof costs] || 0.005;
    return ((tokens / 1000) * cost).toFixed(4);
  };

  const getEstimatedPerformance = () => {
    const baseTimePerItem = 1.5; // seconds per item
    const delayPerItem = config.parallelMode ? (config.delayBetweenBatches / config.concurrency) / 1000 : 0.8;
    const totalTimePerItem = baseTimePerItem + delayPerItem;
    
    if (config.parallelMode) {
      return `~${config.concurrency}x mais rápido`;
    } else {
      return `~${totalTimePerItem.toFixed(1)}s por item`;
    }
  };

  const getEstimatedTotalTime = () => {
    const totalCombinations = selectedArticles.length * selectedItems.length;
    const baseTimePerItem = 1.5;
    const delayPerItem = config.parallelMode ? (config.delayBetweenBatches / config.concurrency) / 1000 : 0.8;
    const totalTimePerItem = baseTimePerItem + delayPerItem;
    
    if (config.parallelMode) {
      const timePerBatch = Math.ceil(totalCombinations / config.concurrency) * totalTimePerItem;
      return `${Math.ceil(timePerBatch / 60)} min`;
    } else {
      return `${Math.ceil((totalCombinations * totalTimePerItem) / 60)} min`;
    }
  };

  const getEstimatedCost = () => {
    const totalCombinations = selectedArticles.length * selectedItems.length;
    const costPerRequest = parseFloat(getTokenCost(config.maxTokens, config.model));
    return (totalCombinations * costPerRequest).toFixed(2);
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl h-[85vh]">
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando configurações...
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuração de IA para Avaliação em Lote
          </DialogTitle>
        </DialogHeader>
        
        <TooltipProvider>
          <Tabs defaultValue="selection" className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
              <TabsTrigger value="selection" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Seleção
              </TabsTrigger>
              <TabsTrigger value="processing" className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Processamento
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Configurações IA
              </TabsTrigger>
              <TabsTrigger value="prompts" className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Prompts por Questão
              </TabsTrigger>
            </TabsList>
            
            <ScrollArea className="flex-1 mt-4 min-h-0">
              <TabsContent value="selection" className="space-y-6 p-1">
                <div className="space-y-6">
                  {/* Seleção de Artigos */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-500" />
                        <Label className="text-base font-medium">Artigos Selecionados</Label>
                        <Badge variant="outline" className="text-xs">
                          {selectedArticles.length} de {articles.length}
                        </Badge>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSelectAllArticles}
                      >
                        {selectedArticles.length === articles.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                      </Button>
                    </div>
                    
                    <div className="max-h-48 overflow-y-auto space-y-2 border rounded-lg p-3">
                      {articles.map((article) => (
                        <div key={article.id} className="flex items-center space-x-3">
                          <Checkbox
                            id={`article-${article.id}`}
                            checked={selectedArticles.includes(article.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedArticles(prev => [...prev, article.id]);
                              } else {
                                setSelectedArticles(prev => prev.filter(id => id !== article.id));
                              }
                            }}
                          />
                          <Label 
                            htmlFor={`article-${article.id}`}
                            className="flex-1 cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium truncate max-w-md">
                                {article.title}
                              </span>
                              <div className="flex items-center gap-2">
                                {article.status && (
                                  <Badge variant="outline" className="text-xs">
                                    {article.status}
                                  </Badge>
                                )}
                                {article.completion_percentage !== undefined && (
                                  <Badge variant="secondary" className="text-xs">
                                    {article.completion_percentage}%
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Seleção de Questões */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-green-500" />
                        <Label className="text-base font-medium">Questões Selecionadas</Label>
                        <Badge variant="outline" className="text-xs">
                          {selectedItems.length} de {assessmentItems.length}
                        </Badge>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSelectAllItems}
                      >
                        {selectedItems.length === assessmentItems.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                      </Button>
                    </div>
                    
                    <div className="max-h-48 overflow-y-auto space-y-2 border rounded-lg p-3">
                      {assessmentItems.map((item) => (
                        <div key={item.id} className="flex items-center space-x-3">
                          <Checkbox
                            id={`item-${item.id}`}
                            checked={selectedItems.includes(item.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedItems(prev => [...prev, item.id]);
                              } else {
                                setSelectedItems(prev => prev.filter(id => id !== item.id));
                              }
                            }}
                          />
                          <Label 
                            htmlFor={`item-${item.id}`}
                            className="flex-1 cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{item.item_code}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-md">
                                {item.question}
                              </span>
                            </div>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Resumo da Seleção */}
                  <div className="rounded-lg border p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                      <h4 className="text-sm font-medium text-blue-900">Resumo da Seleção</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Artigos:</span>
                        <span className="font-medium">{selectedArticles.length}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Questões:</span>
                        <span className="font-medium">{selectedItems.length}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Total de avaliações:</span>
                        <span className="font-medium">{selectedArticles.length * selectedItems.length}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Tempo estimado:</span>
                        <span className="font-medium">{getEstimatedTotalTime()}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Custo estimado:</span>
                        <span className="font-medium">${getEstimatedCost()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="processing" className="space-y-6 p-1">
                <div className="space-y-6">
                  {/* Modo Paralelo */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-blue-500" />
                        <Label className="text-base font-medium">Processamento Paralelo</Label>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Ativa o processamento de múltiplas questões simultaneamente para maior velocidade</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Switch
                        checked={config.parallelMode}
                        onCheckedChange={(checked) => handleConfigChange({ parallelMode: checked })}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Processa múltiplas questões simultaneamente para maior velocidade. Recomendado para grandes volumes.
                    </p>
                    {config.parallelMode && (
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-sm text-blue-700">
                          ⚡ Modo paralelo ativo - {getEstimatedPerformance()}
                        </p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Concorrência */}
                  {config.parallelMode && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-green-500" />
                        <Label className="text-base font-medium">Concorrência: {config.concurrency}</Label>
                        <Badge variant="outline" className="text-xs">
                          {config.concurrency} requisições simultâneas
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <Slider
                          value={[config.concurrency]}
                          onValueChange={([value]) => handleConfigChange({ concurrency: value })}
                          max={5}
                          min={1}
                          step={1}
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>1 (Sequencial)</span>
                          <span>5 (Máx. Paralelo)</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Número de requisições de IA enviadas simultaneamente. Valores mais altos podem ser mais rápidos, mas podem atingir limites de API.
                      </p>
                    </div>
                  )}

                  {/* Delay entre lotes */}
                  {config.parallelMode && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-orange-500" />
                        <Label className="text-base font-medium">Delay entre Lotes: {config.delayBetweenBatches}ms</Label>
                      </div>
                      <div className="space-y-2">
                        <Slider
                          value={[config.delayBetweenBatches]}
                          onValueChange={([value]) => handleConfigChange({ delayBetweenBatches: value })}
                          max={2000}
                          min={500}
                          step={100}
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>500ms (Rápido)</span>
                          <span>2000ms (Seguro)</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Tempo de espera entre lotes para evitar rate limiting da API.
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ai" className="space-y-6 p-1">
                <div className="space-y-6">
                  {/* Modelo */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      <Label className="text-base font-medium">Modelo de IA</Label>
                      <Badge variant="secondary" className="text-xs">
                        {config.model}
                      </Badge>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg border border-dashed">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">GPT-4o Mini</span>
                        <Badge variant="outline" className="text-xs">
                          Otimizado
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Modelo otimizado para melhor custo-benefício
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Temperatura */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Thermometer className="h-4 w-4" />
                      <Label className="text-base font-medium">Temperatura: {config.temperature}</Label>
                      <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 border-green-300">
                        Máxima Consistência
                      </Badge>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                      <p className="text-xs text-green-700">
                        ✓ Configuração otimizada para avaliações científicas com máxima reprodutibilidade
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Tokens Máximos */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      <Label className="text-base font-medium">Tokens Máximos: {config.maxTokens.toLocaleString()}</Label>
                      <Badge variant="outline" className="text-xs">
                        ~${getTokenCost(config.maxTokens, config.model)}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      <Slider
                        value={[config.maxTokens]}
                        onValueChange={([value]) => handleConfigChange({ maxTokens: value })}
                        max={4000}
                        min={500}
                        step={100}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>500 (Econômico)</span>
                        <span>4000 (Detalhado)</span>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Força File Search */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileSearch className="h-4 w-4" />
                        <Label className="text-base font-medium">Forçar Busca Vetorial (RAG)</Label>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Usa busca vetorial mesmo para PDFs pequenos (mais lento, mais preciso)</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Switch
                        checked={config.forceFileSearch}
                        onCheckedChange={(checked) => handleConfigChange({ forceFileSearch: checked })}
                      />
                    </div>
                    {config.forceFileSearch && (
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-xs text-blue-700">
                          ⚡ Busca vetorial ativada - Melhor precisão para documentos complexos
                        </p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Prompts Globais */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Label className="text-base font-medium">Prompts Globais</Label>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Prompt do Sistema</Label>
                        <Textarea
                          value={config.systemPrompt}
                          onChange={(e) => handleConfigChange({ systemPrompt: e.target.value })}
                          placeholder="Defina o papel e expertise da IA..."
                          className="min-h-[80px] font-mono text-xs resize-none"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Template do Prompt do Usuário</Label>
                        <Textarea
                          value={config.userPromptTemplate}
                          onChange={(e) => handleConfigChange({ userPromptTemplate: e.target.value })}
                          placeholder="Template para a pergunta específica..."
                          className="min-h-[100px] font-mono text-xs resize-none"
                        />
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                            <span className="font-medium">Variáveis:</span>
                            <code className="px-1 py-0.5 bg-muted rounded text-xs">{'{{question}}'}</code>
                            <code className="px-1 py-0.5 bg-muted rounded text-xs">{'{{levels}}'}</code>
                            <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{review_title}}'}</code>
                            <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{condition_studied}}'}</code>
                            <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{study_design}}'}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="prompts" className="p-1 h-full flex flex-col min-h-0">
                <div className="flex flex-col h-full space-y-4">
                  {/* Seletor de Questão */}
                  <div className="space-y-3 flex-shrink-0">
                    <Label className="text-base font-medium">Selecionar Questão para Configurar</Label>
                    <ScrollArea className="h-32 border rounded-lg">
                      <div className="grid grid-cols-1 gap-2 p-2">
                        {assessmentItems.map((item) => (
                          <Button
                            key={item.id}
                            variant={selectedItem?.id === item.id ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              setSelectedItem(item);
                              loadItemConfiguration(item);
                            }}
                            className="justify-start text-left h-auto p-3"
                          >
                            <div className="flex flex-col items-start w-full">
                              <span className="font-medium text-xs">{item.item_code}</span>
                              <span className="text-xs text-muted-foreground truncate w-full">
                                {item.question}
                              </span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {selectedItem && (
                    <>
                      <Separator className="flex-shrink-0" />
                      
                      <div className="flex-1 flex flex-col min-h-0 space-y-4">
                        <div className="flex items-center justify-between flex-shrink-0">
                          <div>
                            <h4 className="font-medium">Configuração da Questão</h4>
                            <p className="text-sm text-muted-foreground">{selectedItem.item_code}</p>
                          </div>
                          <Button
                            onClick={handleSaveItemConfig}
                            disabled={saving}
                            size="sm"
                          >
                            {saving ? (
                              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-3 w-3" />
                            )}
                            Salvar Questão
                          </Button>
                        </div>

                        <div className="flex-1 flex flex-col min-h-0 space-y-4">
                          <div className="flex-1 flex flex-col space-y-2 min-h-0">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm font-medium">Prompt do Sistema</Label>
                              <Badge variant="outline" className="text-xs">
                                {itemConfig.systemPrompt.length} caracteres
                              </Badge>
                            </div>
                            <Textarea
                              value={itemConfig.systemPrompt}
                              onChange={(e) => setItemConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                              placeholder="Defina o papel e expertise da IA..."
                              className="flex-1 font-mono text-xs resize-none min-h-[120px] max-h-[200px]"
                            />
                          </div>

                          <div className="flex-1 flex flex-col space-y-2 min-h-0">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm font-medium">Template do Prompt do Usuário</Label>
                              <Badge variant="outline" className="text-xs">
                                {itemConfig.userPromptTemplate.length} caracteres
                              </Badge>
                            </div>
                            <Textarea
                              value={itemConfig.userPromptTemplate}
                              onChange={(e) => setItemConfig(prev => ({ ...prev, userPromptTemplate: e.target.value }))}
                              placeholder="Template para a pergunta específica..."
                              className="flex-1 font-mono text-xs resize-none min-h-[150px] max-h-[250px]"
                            />
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                                <span className="font-medium">Variáveis disponíveis:</span>
                                <code className="px-1 py-0.5 bg-muted rounded text-xs">{'{{question}}'}</code>
                                <code className="px-1 py-0.5 bg-muted rounded text-xs">{'{{levels}}'}</code>
                                <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{review_title}}'}</code>
                                <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{condition_studied}}'}</code>
                                <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{study_design}}'}</code>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  
                  {!selectedItem && (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                      <p className="text-sm">Selecione uma questão para configurar seus prompts</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </TooltipProvider>

        {/* Ações */}
        <div className="pt-6 border-t flex-shrink-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleStartProcessing}
              disabled={saving || selectedArticles.length === 0 || selectedItems.length === 0}
              className="flex-1"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Iniciar Processamento em Lote
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="mr-2 h-4 w-4" />
              Salvar Configurações
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={saving}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Resetar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
