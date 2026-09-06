/**
 * Feedback dialog — bugs, suggestions, questions, with one optional image or
 * video attached from disk and uploaded to Supabase Storage.
 */
import { useEffect, useId, useState } from 'react';
import { MessageSquare, Paperclip, X } from 'lucide-react';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFeedback } from '@/hooks/useFeedback';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { checkFeedbackMedia, FEEDBACK_MEDIA_ACCEPT, type FeedbackMediaSpec } from '@/lib/feedback-media';
import { FeedbackService } from '@/services/feedbackService';
import { t } from '@/lib/copy';
import type { FeedbackAttachmentInput, FeedbackSeverity, FeedbackType } from '@/types/feedback';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PendingAttachment {
  file: File;
  spec: FeedbackMediaSpec;
  previewUrl: string;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FeedbackSeverity | undefined>();
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // The object already stored for a given File. Keyed on the File itself, so
  // picking a different one invalidates it without any manual clearing: a
  // failed submit then retries the API call instead of re-sending up to 50 MB.
  const [uploaded, setUploaded] = useState<{file: File; input: FeedbackAttachmentInput} | null>(null);
  const fileInputId = useId();

  // Revoke the preview object URL when the attachment is replaced, cleared,
  // or the dialog unmounts, so blob URLs don't leak.
  useEffect(() => {
    if (!attachment) return;
    return () => URL.revokeObjectURL(attachment.previewUrl);
  }, [attachment]);

  const { submitFeedback, submitting } = useFeedback();
  const { user } = useAuth();
  const { toast } = useToast();

  const isDescriptionValid = description.trim().length >= 10;
  // Valid only while it still describes the file currently attached.
  const storedAttachment = attachment && uploaded?.file === attachment.file ? uploaded.input : null;
  const busy = submitting || uploading;

  const onPickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Clear the input so re-picking the same file after a rejection still fires.
    event.target.value = '';
    if (!picked) return;

    const check = checkFeedbackMedia(picked);
    if (!check.ok) {
      setAttachmentError(t('navigation', check.reason === 'size' ? 'feedbackAttachTooLarge' : 'feedbackAttachWrongType'));
      return;
    }
    setAttachmentError(null);
    setAttachment({ file: picked, spec: check.spec, previewUrl: URL.createObjectURL(picked) });
  };

  const resetAndClose = () => {
    setType('bug'); setSummary(''); setDescription(''); setSeverity(undefined);
    setAttachment(null); setAttachmentError(null); setUploaded(null);
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDescriptionValid) return;

    let stored = storedAttachment;
    if (attachment && user && !stored) {
      setUploading(true);
      const result = await FeedbackService.uploadAttachment(attachment.file, user.id, attachment.spec);
      setUploading(false);
      if (!result.ok) {
        toast({
          title: t('navigation', 'feedbackAttachUploadFailed'),
          description: result.error.message,
          variant: 'destructive',
        });
        return;
      }
      stored = result.data;
      setUploaded({file: attachment.file, input: stored});
    }

    const ok = await submitFeedback(
      { type, summary: summary || undefined, description, severity: type === 'bug' ? severity : undefined },
      stored ? [stored] : [],
    );
    if (ok) resetAndClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : resetAndClose())}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {t('navigation', 'feedbackTitle')}
            </DialogTitle>
            <DialogDescription>{t('navigation', 'feedbackDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('navigation', 'feedbackTypeLabel')}</Label>
              <RadioGroup value={type} onValueChange={(v) => setType(v as FeedbackType)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="bug" id="bug" />
                  <Label htmlFor="bug" className="font-normal cursor-pointer">🐛 {t('navigation', 'feedbackTypeBug')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="suggestion" id="suggestion" />
                  <Label htmlFor="suggestion" className="font-normal cursor-pointer">💡 {t('navigation', 'feedbackTypeSuggestion')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="question" id="question" />
                  <Label htmlFor="question" className="font-normal cursor-pointer">❓ {t('navigation', 'feedbackTypeQuestion')}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other" className="font-normal cursor-pointer">💬 {t('navigation', 'feedbackTypeOther')}</Label>
                </div>
              </RadioGroup>
            </div>

            {type === 'bug' && (
              <div className="space-y-2">
                <Label htmlFor="severity">{t('navigation', 'feedbackSeverityLabel')}</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as FeedbackSeverity)}>
                  <SelectTrigger id="severity">
                    <SelectValue placeholder={t('navigation', 'feedbackSeverityPlaceholder')} />
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
              <Label htmlFor="summary">{t('navigation', 'feedbackSummaryLabel')}</Label>
              <Input
                id="summary"
                value={summary}
                maxLength={200}
                placeholder={t('navigation', 'feedbackSummaryPlaceholder')}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>

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
                {description.length < 10
                  ? <>{t('navigation', 'feedbackDescriptionMin')} ({10 - description.length} {t('navigation', 'feedbackDescriptionRemaining')})</>
                  : <>&#x2713; {t('navigation', 'feedbackDescriptionValid')}</>}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={fileInputId}>{t('navigation', 'feedbackAttachLabel')}</Label>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  {/* `relative`: the sr-only input inside is absolutely positioned —
                      without a positioned ancestor it adds phantom page scroll. */}
                  <label htmlFor={fileInputId} className="relative shrink-0 cursor-pointer">
                    <Paperclip strokeWidth={1.5} aria-hidden="true" />
                    {t('navigation', 'feedbackAttachChoose')}
                    <input
                      id={fileInputId}
                      type="file"
                      accept={FEEDBACK_MEDIA_ACCEPT}
                      className="sr-only"
                      data-testid="feedback-media-input"
                      onChange={onPickFile}
                    />
                  </label>
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {attachment?.file.name ?? t('navigation', 'feedbackAttachNone')}
                </span>
                {attachment && (
                  <Button type="button" variant="ghost" size="xs" onClick={() => setAttachment(null)}>
                    <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t('navigation', 'feedbackAttachRemove')}
                  </Button>
                )}
              </div>
              {attachment && (
                <div className="rounded-md border p-2">
                  {attachment.spec.kind === 'image'
                    ? <img src={attachment.previewUrl} alt="" className="h-16 w-auto rounded" />
                    : <video src={attachment.previewUrl} className="h-16 w-auto rounded" controls />}
                </div>
              )}
              <p className={`text-xs ${attachmentError ? 'text-destructive' : 'text-muted-foreground'}`}>
                {attachmentError ?? t('navigation', 'feedbackAttachNotice')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" type="button" variant="outline" onClick={resetAndClose} disabled={busy}>
              {t('common', 'cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={busy || !isDescriptionValid}>
              {busy ? t('navigation', 'feedbackSubmitting') : t('navigation', 'feedbackSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
