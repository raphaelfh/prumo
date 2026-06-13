/**
 * Feedback dialog — bugs, suggestions, questions, with optional
 * getDisplayMedia screenshot/clip uploaded to Supabase Storage.
 */
import { useEffect, useState } from 'react';
import { MessageSquare, Camera, Video, X } from 'lucide-react';

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
import { useScreenCapture } from '@/hooks/useScreenCapture';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { t } from '@/lib/copy';
import type { FeedbackAttachmentInput, FeedbackSeverity, FeedbackType } from '@/types/feedback';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BUCKET = 'feedback-media';

interface PendingCapture {
  kind: 'image' | 'video';
  blob: Blob;
  previewUrl: string;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FeedbackSeverity | undefined>();
  const [capture, setCapture] = useState<PendingCapture | null>(null);

  // Revoke the preview object URL when the capture is replaced or the
  // dialog unmounts, so blob URLs don't leak.
  useEffect(() => {
    if (!capture) return;
    return () => URL.revokeObjectURL(capture.previewUrl);
  }, [capture]);

  const { submitFeedback, submitting } = useFeedback();
  const { isSupported, capturing, captureStill, recordClip } = useScreenCapture();
  const { user } = useAuth();
  const { toast } = useToast();

  const isDescriptionValid = description.trim().length >= 10;

  const onCapture = async (kind: 'image' | 'video') => {
    const blob = kind === 'image' ? await captureStill() : await recordClip(30);
    if (!blob) {
      toast({
        title: t('navigation', 'feedbackCaptureFailed'),
        variant: 'destructive',
      });
      return;
    }
    setCapture({ kind, blob, previewUrl: URL.createObjectURL(blob) });
  };

  const clearCapture = () => {
    if (capture) URL.revokeObjectURL(capture.previewUrl);
    setCapture(null);
  };

  const uploadCapture = async (): Promise<FeedbackAttachmentInput[]> => {
    if (!capture || !user) return [];
    const ext = capture.kind === 'image' ? 'webp' : 'webm';
    const key = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(key, capture.blob, {
      contentType: capture.blob.type,
    });
    if (error) throw new Error(error.message);
    return [{
      kind: capture.kind,
      storage_key: key,
      content_type: capture.blob.type,
      size_bytes: capture.blob.size,
    }];
  };

  const resetAndClose = () => {
    setType('bug'); setSummary(''); setDescription(''); setSeverity(undefined);
    clearCapture();
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDescriptionValid) return;

    let attachments: FeedbackAttachmentInput[];
    try {
      attachments = await uploadCapture();
    } catch (err) {
      toast({
        title: t('navigation', 'feedbackCaptureFailed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
      return;
    }

    const ok = await submitFeedback(
      { type, summary: summary || undefined, description, severity: type === 'bug' ? severity : undefined },
      attachments,
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
              <div className="flex gap-2">
                <Button
                  type="button" variant="outline" size="sm"
                  disabled={!isSupported || capturing}
                  onClick={() => onCapture('image')}
                >
                  <Camera className="h-4 w-4 mr-1" /> {t('navigation', 'feedbackAttachScreenshot')}
                </Button>
                <Button
                  type="button" variant="outline" size="sm"
                  disabled={!isSupported || capturing}
                  onClick={() => onCapture('video')}
                >
                  <Video className="h-4 w-4 mr-1" /> {t('navigation', 'feedbackRecordClip')}
                </Button>
              </div>
              {capture && (
                <div className="flex items-center gap-2 rounded-md border p-2">
                  {capture.kind === 'image'
                    ? <img src={capture.previewUrl} alt="" className="h-16 w-auto rounded" />
                    : <video src={capture.previewUrl} className="h-16 w-auto rounded" controls />}
                  <Button type="button" variant="ghost" size="sm" onClick={clearCapture}>
                    <X className="h-4 w-4 mr-1" /> {t('navigation', 'feedbackCaptureRemove')}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {isSupported
                  ? t('navigation', 'feedbackCaptureNotice')
                  : t('navigation', 'feedbackCaptureUnsupported')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
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
