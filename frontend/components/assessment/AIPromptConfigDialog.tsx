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
import {t} from '@/lib/copy';

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
          title: t('assessment', 'aiPromptToastSaved'),
          description: t('assessment', 'aiPromptToastSavedDesc'),
      });
      setOpen(false);
    } catch (error) {
      console.error('Error saving prompt config:', error);
      toast({
          title: t('assessment', 'aiPromptToastError'),
          description: error instanceof Error ? error.message : t('assessment', 'aiPromptToastErrorDesc'),
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
          title={t('assessment', 'aiPromptTriggerTitle')}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
            <DialogTitle>{t('assessment', 'aiPromptDialogTitle')}</DialogTitle>
          <DialogDescription>
              {t('assessment', 'aiPromptDialogDesc')}: "{itemQuestion}"
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <div className="space-y-2">
                <Label htmlFor="system-prompt">{t('assessment', 'aiPromptSystemLabel')}</Label>
              <Textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('assessment', 'aiPromptSystemPlaceholder')}
                className="min-h-[100px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                  {t('assessment', 'aiPromptSystemDesc')}
              </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="user-prompt">{t('assessment', 'aiPromptUserLabel')}</Label>
              <Textarea
                id="user-prompt"
                value={userPromptTemplate}
                onChange={(e) => setUserPromptTemplate(e.target.value)}
                placeholder={t('assessment', 'aiPromptUserPlaceholder')}
                className="min-h-[150px] font-mono text-sm"
              />
              <div className="text-xs text-muted-foreground space-y-1">
                  <p>{t('assessment', 'aiPromptVariablesTitle')}</p>
                <ul className="list-disc list-inside ml-2">
                    <li><code
                        className="bg-muted px-1 rounded">{'{{question}}'}</code> – {t('assessment', 'aiPromptVarQuestion')}
                    </li>
                    <li><code
                        className="bg-muted px-1 rounded">{'{{levels}}'}</code> – {t('assessment', 'aiPromptVarLevels')}
                    </li>
                </ul>
              </div>
            </div>

            <div className="rounded-lg border p-4 bg-muted/50">
                <h4 className="text-sm font-medium mb-2">{t('assessment', 'aiPromptPreviewTitle')}</h4>
              <div className="text-xs space-y-2 font-mono">
                <div>
                    <strong>{t('assessment', 'aiPromptPreviewSystem')}</strong>
                  <p className="mt-1 text-muted-foreground">{systemPrompt}</p>
                </div>
                <div>
                    <strong>{t('assessment', 'aiPromptPreviewUser')}</strong>
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
              {t('common', 'cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('assessment', 'aiPromptSaving')}
              </>
            ) : (
                t('assessment', 'aiPromptSaveConfig')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};