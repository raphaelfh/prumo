/**
 * Feedback dialog — minimal form for bugs, suggestions, questions.
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
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {useFeedback} from '@/hooks/useFeedback';
import type {FeedbackSeverity, FeedbackType} from '@/types/feedback';
import {t} from '@/lib/copy';

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
                {t('navigation', 'feedbackTitle')}
            </DialogTitle>
            <DialogDescription>
                {t('navigation', 'feedbackDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
                <Label>{t('navigation', 'feedbackTypeLabel')}</Label>
              <RadioGroup value={type} onValueChange={(v) => setType(v as FeedbackType)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="bug" id="bug" />
                  <Label htmlFor="bug" className="font-normal cursor-pointer">
                      🐛 {t('navigation', 'feedbackTypeBug')}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="suggestion" id="suggestion" />
                  <Label htmlFor="suggestion" className="font-normal cursor-pointer">
                      💡 {t('navigation', 'feedbackTypeSuggestion')}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="question" id="question" />
                  <Label htmlFor="question" className="font-normal cursor-pointer">
                      ❓ {t('navigation', 'feedbackTypeQuestion')}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other" className="font-normal cursor-pointer">
                      💬 {t('navigation', 'feedbackTypeOther')}
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {type === 'bug' && (
              <div className="space-y-2">
                  <Label htmlFor="severity">{t('navigation', 'feedbackSeverityLabel')}</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as FeedbackSeverity)}>
                  <SelectTrigger id="severity">
                      <SelectValue placeholder={t('navigation', 'feedbackSeverityPlaceholder')}/>
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="low">{t('navigation', 'feedbackSeverityLow')}</SelectItem>
                      <SelectItem value="medium">{t('navigation', 'feedbackSeverityMedium')}</SelectItem>
                      <SelectItem value="high">{t('navigation', 'feedbackSeverityHigh')}</SelectItem>
                      <SelectItem value="critical">{t('navigation', 'feedbackSeverityCritical')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="description">
                  {t('navigation', 'feedbackDescriptionLabel')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder={t('navigation', 'feedbackDescriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="resize-none"
                required
              />
              <p className="text-xs text-muted-foreground">
                {description.length < 10 ? (
                    <>{t('navigation', 'feedbackDescriptionMin')} ({10 - description.length} {t('navigation', 'feedbackDescriptionRemaining')})</>
                ) : (
                    <>✓ {t('navigation', 'feedbackDescriptionValid')}</>
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
                {t('common', 'cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !isDescriptionValid}>
                {submitting ? t('navigation', 'feedbackSubmitting') : t('navigation', 'feedbackSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

