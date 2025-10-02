import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
  RotateCcw
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AIConfiguration {
  model: string;
  temperature: number;
  maxTokens: number;
  forceFileSearch: boolean;
  systemPrompt: string;
  userPromptTemplate: string;
}

interface AIConfigurationPanelProps {
  assessmentItemId: string;
  itemQuestion: string;
  projectId: string;
  onConfigurationChange: (config: AIConfiguration) => void;
}

const AI_MODELS = [
  { value: 'gpt-5-mini', label: 'GPT-5 Mini (Padrão)', description: 'Melhor custo-benefício, última geração' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Boa qualidade, mais rápido' },
  { value: 'gpt-4o', label: 'GPT-4o', description: 'Melhor qualidade, mais caro' },
];

const DEFAULT_CONFIG: AIConfiguration = {
  model: 'gpt-5-mini',
  temperature: 0.0, // Fixo em zero para máxima consistência
  maxTokens: 2000,
  forceFileSearch: false,
  systemPrompt: 'You are an expert research quality assessor. Analyze the provided research article and answer the specific question based on the evidence found in the text.',
  userPromptTemplate: 'Based on the article content, assess: {{question}}\n\nAvailable response levels: {{levels}}\n\nProject Context:\n- Review Title: {{review_title}}\n- Condition Studied: {{condition_studied}}\n- Study Design: {{study_design}}\n\nProvide your assessment with clear justification and cite specific passages from the text that support your conclusion.'
};

export const AIConfigurationPanel = ({
  assessmentItemId,
  itemQuestion,
  projectId,
  onConfigurationChange
}: AIConfigurationPanelProps) => {
  const [config, setConfig] = useState<AIConfiguration>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projectData, setProjectData] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadConfiguration();
    loadProjectData();
  }, [assessmentItemId, projectId]);

  const loadConfiguration = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_assessment_prompts')
        .select('*')
        .eq('assessment_item_id', assessmentItemId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setConfig(prev => ({
          ...prev,
          systemPrompt: data.system_prompt,
          userPromptTemplate: data.user_prompt_template,
        }));
      }
    } catch (error) {
      console.error('Error loading AI configuration:', error);
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

  const handleConfigChange = (updates: Partial<AIConfiguration>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    onConfigurationChange(newConfig);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('ai_assessment_prompts')
        .upsert({
          assessment_item_id: assessmentItemId,
          system_prompt: config.systemPrompt,
          user_prompt_template: config.userPromptTemplate,
        }, {
          onConflict: 'assessment_item_id'
        });

      if (error) throw error;

      toast({
        title: "Configuração salva",
        description: "Configurações da IA atualizadas com sucesso",
      });
    } catch (error) {
      console.error('Error saving AI configuration:', error);
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
    onConfigurationChange(DEFAULT_CONFIG);
    toast({
      title: "Configuração resetada",
      description: "Configurações restauradas para os valores padrão",
    });
  };

  const getTemperatureLabel = (temp: number) => {
    if (temp <= 0.2) return 'Muito Conservador';
    if (temp <= 0.5) return 'Conservador';
    if (temp <= 0.7) return 'Equilibrado';
    if (temp <= 0.9) return 'Criativo';
    return 'Muito Criativo';
  };

  const getTokenCost = (tokens: number, model: string) => {
    // Estimativas aproximadas de custo por 1K tokens (USD)
    const costs = {
      'gpt-4o': 0.005,
      'gpt-4o-mini': 0.00015,
      'gpt-4-turbo': 0.01,
    };
    const cost = costs[model as keyof typeof costs] || 0.005;
    return ((tokens / 1000) * cost).toFixed(4);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando configurações...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-6">
            <Settings className="h-5 w-5" />
            Configurações Avançadas da IA
          </h2>
        </div>
        
        <div className="space-y-6">
              {/* Modelo - Fixo para melhor custo-benefício */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  <Label>Modelo de IA</Label>
                  <Badge variant="secondary" className="text-xs">
                    Fixo
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Usando gpt-5-mini para melhor custo-benefício</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg border border-dashed">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">GPT-5 Mini</span>
                    <Badge variant="outline" className="text-xs">
                      Última Geração
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Modelo otimizado para melhor custo-benefício
                  </p>
                </div>
              </div>

              <Separator />

              {/* Temperatura - Fixa em 0.0 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Thermometer className="h-4 w-4" />
                  <Label>Temperatura: 0.0</Label>
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 border-green-300">
                    Máxima Consistência
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Temperatura fixa em 0.0 para respostas determinísticas e consistentes</p>
                    </TooltipContent>
                  </Tooltip>
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
                  <Label>Tokens Máximos: {config.maxTokens.toLocaleString()}</Label>
                  <Badge variant="outline" className="text-xs">
                    ~${getTokenCost(config.maxTokens, config.model)}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Limite máximo de tokens para a resposta (afeta custo)</p>
                    </TooltipContent>
                  </Tooltip>
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
                    <Label>Forçar Busca Vetorial (RAG)</Label>
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

              {/* Prompts */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <Label className="text-base font-medium">Configuração de Prompts</Label>
                </div>
                
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Prompt do Sistema</Label>
                    <Textarea
                      value={config.systemPrompt}
                      onChange={(e) => handleConfigChange({ systemPrompt: e.target.value })}
                      placeholder="Defina o papel e expertise da IA..."
                      className="min-h-[80px] sm:min-h-[100px] font-mono text-xs sm:text-sm resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Template do Prompt do Usuário</Label>
                    <Textarea
                      value={config.userPromptTemplate}
                      onChange={(e) => handleConfigChange({ userPromptTemplate: e.target.value })}
                      placeholder="Template para a pergunta específica..."
                      className="min-h-[100px] sm:min-h-[120px] font-mono text-xs sm:text-sm resize-none"
                    />
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1 sm:gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">Variáveis Básicas:</span>
                        <code className="px-1 py-0.5 bg-muted rounded text-xs">{'{{question}}'}</code>
                        <code className="px-1 py-0.5 bg-muted rounded text-xs">{'{{levels}}'}</code>
                      </div>
                      <div className="flex flex-wrap gap-1 sm:gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">Variáveis do Projeto:</span>
                        <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{description}}'}</code>
                        <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{review_title}}'}</code>
                        <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{condition_studied}}'}</code>
                        <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{eligibility_criteria}}'}</code>
                        <code className="px-1 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{'{{study_design}}'}</code>
                      </div>
                      {projectData && (
                        <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
                          <p className="text-xs text-blue-700 font-medium mb-1">Valores atuais do projeto:</p>
                          <div className="space-y-1 text-xs text-blue-600">
                            {projectData.description && <div><strong>Descrição:</strong> {projectData.description}</div>}
                            {projectData.review_title && <div><strong>Título:</strong> {projectData.review_title}</div>}
                            {projectData.condition_studied && <div><strong>Condição:</strong> {projectData.condition_studied}</div>}
                            {projectData.eligibility_criteria && <div><strong>Critérios:</strong> {JSON.stringify(projectData.eligibility_criteria)}</div>}
                            {projectData.study_design && <div><strong>Design:</strong> {JSON.stringify(projectData.study_design)}</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg border p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                  <h4 className="text-sm font-medium text-blue-900">Resumo da Configuração</h4>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                      <span className="text-muted-foreground">Modelo:</span>
                      <span className="font-medium">GPT-5 Mini</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                      <span className="text-muted-foreground">Temperatura:</span>
                      <span className="font-medium text-green-700">0.0</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                      <span className="text-muted-foreground">Max Tokens:</span>
                      <span className="font-medium">{config.maxTokens.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-white/60 rounded border">
                      <span className="text-muted-foreground">RAG:</span>
                      <span className="font-medium">{config.forceFileSearch ? '✓ Ativo' : '○ Automático'}</span>
                    </div>
                  </div>
                  <div className="p-2 sm:p-3 bg-blue-100 rounded-lg border border-blue-300">
                    <p className="text-xs text-blue-800">
                      <strong>💡 Otimização:</strong> Configuração balanceada para avaliações científicas precisas e custo-efetivas
                    </p>
                  </div>
                </div>
              </div>

        </div>
        
        {/* Ações */}
        <div className="pt-6 border-t">
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
                  Salvar Configuração
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
      </div>
    </TooltipProvider>
  );
};
