import {useEffect, useState} from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Loader2, Settings} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {useToast} from '@/hooks/use-toast';

interface AIPromptConfigDialogProps {
  assessmentItemId: string;
  itemQuestion: string;
}

export const AIPromptConfigDialog = ({
  assessmentItemId,
  itemQuestion
}: AIPromptConfigDialogProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(
    'You are an expert research quality assessor. Analyze the provided research article and answer the specific question based on the evidence found in the text.'
  );
  const [userPromptTemplate, setUserPromptTemplate] = useState(
    'Based on the article content, assess: {{question}}\n\nAvailable response levels: {{levels}}\n\nProvide your assessment with clear justification and cite specific passages from the text that support your conclusion.'
  );
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      loadPromptConfig();
    }
  }, [open, assessmentItemId]);

  const loadPromptConfig = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_assessment_prompts')
        .select('*')
        .eq('assessment_item_id', assessmentItemId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSystemPrompt(data.system_prompt);
        setUserPromptTemplate(data.user_prompt_template);
      }
    } catch (error) {
      console.error('Error loading prompt config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('ai_assessment_prompts')
        .upsert({
          assessment_item_id: assessmentItemId,
          system_prompt: systemPrompt,
          user_prompt_template: userPromptTemplate,
        }, {
          onConflict: 'assessment_item_id'
        });

      if (error) throw error;

      toast({
        title: "Configuração salva",
        description: "Template de prompt atualizado com sucesso",
      });
      setOpen(false);
    } catch (error) {
      console.error('Error saving prompt config:', error);
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Configurar prompt da IA"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Prompt da IA</DialogTitle>
          <DialogDescription>
            Customize como a IA avalia esta questão: "{itemQuestion}"
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="system-prompt">Instrução do Sistema</Label>
              <Textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Descreva o papel e expertise da IA..."
                className="min-h-[100px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Define o contexto e expertise da IA para a avaliação
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-prompt">Template do Prompt do Usuário</Label>
              <Textarea
                id="user-prompt"
                value={userPromptTemplate}
                onChange={(e) => setUserPromptTemplate(e.target.value)}
                placeholder="Template para a pergunta específica..."
                className="min-h-[150px] font-mono text-sm"
              />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Variáveis disponíveis:</p>
                <ul className="list-disc list-inside ml-2">
                  <li><code className="bg-muted px-1 rounded">{'{{question}}'}</code> - A pergunta do item de avaliação</li>
                  <li><code className="bg-muted px-1 rounded">{'{{levels}}'}</code> - Os níveis de resposta permitidos</li>
                </ul>
              </div>
            </div>

            <div className="rounded-lg border p-4 bg-muted/50">
              <h4 className="text-sm font-medium mb-2">Preview do Prompt Final:</h4>
              <div className="text-xs space-y-2 font-mono">
                <div>
                  <strong>Sistema:</strong>
                  <p className="mt-1 text-muted-foreground">{systemPrompt}</p>
                </div>
                <div>
                  <strong>Usuário:</strong>
                  <p className="mt-1 text-muted-foreground">
                    {userPromptTemplate
                      .replace('{{question}}', itemQuestion)
                      .replace('{{levels}}', 'low, high, unclear')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar Configuração'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};