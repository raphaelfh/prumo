/**
 * Dialog para coleta de feedback dos usuários
 * Formulário minimalista para reportar bugs, sugestões e dúvidas
 */

import {useState} from 'react';
import {MessageSquare} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {useFeedback} from '@/hooks/useFeedback';
import type {FeedbackSeverity, FeedbackType} from '@/types/feedback';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FeedbackSeverity | undefined>();
  
  const { submitFeedback, submitting } = useFeedback();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (description.trim().length < 10) {
      return;
    }

    const success = await submitFeedback({
      type,
      description,
      severity: type === 'bug' ? severity : undefined,
    });

    if (success) {
      // Reset form
      setType('bug');
      setDescription('');
      setSeverity(undefined);
      onOpenChange(false);
    }
  };

  const isDescriptionValid = description.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Enviar Feedback
            </DialogTitle>
            <DialogDescription>
              Encontrou um bug ou tem uma sugestão? Adoramos ouvir você!
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Tipo de Feedback */}
            <div className="space-y-2">
              <Label>Tipo de feedback</Label>
              <RadioGroup value={type} onValueChange={(v) => setType(v as FeedbackType)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="bug" id="bug" />
                  <Label htmlFor="bug" className="font-normal cursor-pointer">
                    🐛 Bug / Problema
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="suggestion" id="suggestion" />
                  <Label htmlFor="suggestion" className="font-normal cursor-pointer">
                    💡 Sugestão de melhoria
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="question" id="question" />
                  <Label htmlFor="question" className="font-normal cursor-pointer">
                    ❓ Dúvida / Pergunta
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other" className="font-normal cursor-pointer">
                    💬 Outro
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Severidade (apenas para bugs) */}
            {type === 'bug' && (
              <div className="space-y-2">
                <Label htmlFor="severity">Severidade (opcional)</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as FeedbackSeverity)}>
                  <SelectTrigger id="severity">
                    <SelectValue placeholder="Selecione a severidade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa - Problema cosmético</SelectItem>
                    <SelectItem value="medium">Média - Funcionalidade afetada</SelectItem>
                    <SelectItem value="high">Alta - Não consigo usar</SelectItem>
                    <SelectItem value="critical">Crítica - App travou/quebrou</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Descrição */}
            <div className="space-y-2">
              <Label htmlFor="description">
                Descrição <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Descreva o problema ou sugestão em detalhes..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="resize-none"
                required
              />
              <p className="text-xs text-muted-foreground">
                {description.length < 10 ? (
                  <>Mínimo 10 caracteres ({10 - description.length} restantes)</>
                ) : (
                  <>✓ Descrição válida. Contexto técnico será capturado automaticamente.</>
                )}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !isDescriptionValid}>
              {submitting ? 'Enviando...' : 'Enviar Feedback'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

