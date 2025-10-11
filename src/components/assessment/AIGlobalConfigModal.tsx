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
  Layers
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

interface AIGlobalConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  items: AssessmentItem[];
  onConfigChange: (config: AIGlobalConfig) => void;
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

export const AIGlobalConfigModal = ({
  open,
  onOpenChange,
  projectId,
  items,
  onConfigChange
}: AIGlobalConfigModalProps) => {
  const [config, setConfig] = useState<AIGlobalConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
    }
  }, [open, projectId]);

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
    onConfigChange(newConfig);
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
    onConfigChange(DEFAULT_CONFIG);
    toast({
      title: "Configuração resetada",
      description: "Configurações restauradas para os valores padrão",
    });
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

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl h-[80vh]">
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
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configurações Globais de IA
          </DialogTitle>
        </DialogHeader>
        
        <TooltipProvider>
          <Tabs defaultValue="processing" className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
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

                  {/* Resumo de Performance */}
                  <div className="rounded-lg border p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                      <h4 className="text-sm font-medium text-blue-900">Estimativa de Performance</h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Modo:</span>
                        <span className="font-medium">{config.parallelMode ? 'Paralelo' : 'Sequencial'}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Performance:</span>
                        <span className="font-medium">{getEstimatedPerformance()}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                        <span className="text-muted-foreground">Questões pendentes:</span>
                        <span className="font-medium">{items.length}</span>
                      </div>
                    </div>
                  </div>
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

              <TabsContent value="prompts" className="space-y-6 p-1">
                <div className="space-y-6">
                  {/* Seletor de Questão */}
                  <div className="space-y-3">
                    <Label className="text-base font-medium">Selecionar Questão para Configurar</Label>
                    <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto">
                      {items.map((item) => (
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
                          <div className="flex flex-col items-start">
                            <span className="font-medium text-xs">{item.item_code}</span>
                            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                              {item.question}
                            </span>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </div>

                  {selectedItem && (
                    <>
                      <Separator />
                      
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
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

                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Prompt do Sistema</Label>
                            <Textarea
                              value={itemConfig.systemPrompt}
                              onChange={(e) => setItemConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                              placeholder="Defina o papel e expertise da IA..."
                              className="min-h-[80px] font-mono text-xs resize-none"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Template do Prompt do Usuário</Label>
                            <Textarea
                              value={itemConfig.userPromptTemplate}
                              onChange={(e) => setItemConfig(prev => ({ ...prev, userPromptTemplate: e.target.value }))}
                              placeholder="Template para a pergunta específica..."
                              className="min-h-[100px] font-mono text-xs resize-none"
                            />
                          </div>
                        </div>
                      </div>
                    </>
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
              onClick={handleSave}
              disabled={saving}
              className="flex-1"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Salvar Configurações
                </>
              )}
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
