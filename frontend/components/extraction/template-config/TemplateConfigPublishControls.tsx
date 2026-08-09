import {useState} from 'react';
import {UploadCloud} from 'lucide-react';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useTemplateConfigStatus} from '@/hooks/extraction/useTemplateConfigStatus';
import {useTemplateRepublish} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';

/**
 * The B-4 Draft chip + explicit Publish button (command-bar cluster).
 *
 * Publish is disabled unless the status query POSITIVELY reports pending
 * changes — loading and error states never enable a publish. The failure
 * toast lives in useTemplateRepublish; only the success toast is here
 * (it needs the returned version number).
 *
 * B-9a adds the server-computed draft change count to the pending chip;
 * see the D9 note on `draftChangeCount` below for the null/zero rule.
 */

interface TemplateConfigPublishControlsProps {
  projectId: string;
  templateId: string;
}

export function TemplateConfigPublishControls({
  projectId,
  templateId,
}: TemplateConfigPublishControlsProps) {
  const {data: configStatus} = useTemplateConfigStatus(projectId, templateId);
  const {republish} = useTemplateRepublish(projectId, templateId);
  const [publishing, setPublishing] = useState(false);

  const hasPendingChanges = configStatus?.has_pending_changes === true;
  // B-9a/D9: the count qualifies the chip only when it is a POSITIVE
  // integer. `null` (unreliable or absent baseline) and `0` (a no-op draft
  // — the 0048 triggers stamp the marker even when the snapshot is
  // identical) both fall back to the bare badge; "Draft · 0 changes" would
  // be nonsense. Publish is never coupled to the count: publishing clears
  // the marker in the zero case too.
  const rawCount = configStatus?.pending_change_count;
  const draftChangeCount =
    typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount > 0
      ? rawCount
      : null;

  const handlePublish = () => {
    setPublishing(true);
    // Promise .finally (not try/finally — compiler-banned in component
    // bodies) so an invalidation rejection can never strand the button.
    void republish()
      .then((result) => {
        if (result) {
          toast.success(
            t('extraction', 'configPublishSuccess').replace(
              '{{n}}',
              String(result.version),
            ),
          );
        }
      })
      .finally(() => setPublishing(false));
  };

  let chip = null;
  if (hasPendingChanges) {
    chip = (
      <Badge
        variant="outline"
        className="border-warning/50 bg-warning/10 text-xs text-warning"
      >
        {draftChangeCount == null
          ? t('extraction', 'configUnpublishedChanges')
          : (draftChangeCount === 1
              ? t('templateConfig', 'draftChangeCountOne')
              : t('templateConfig', 'draftChangeCountOther')
            ).replace('{{n}}', String(draftChangeCount))}
      </Badge>
    );
  } else if (configStatus?.active_version != null) {
    chip = (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        {t('extraction', 'configPublishedVersion').replace(
          '{{n}}',
          String(configStatus.active_version),
        )}
      </Badge>
    );
  }

  return (
    <>
      {chip}
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span keeps the tooltip alive while the button is disabled */}
          <span className="inline-flex">
            <Button
              size="sm"
              className="h-8"
              onClick={() => void handlePublish()}
              disabled={publishing || !hasPendingChanges}
              aria-label={t('extraction', 'configPublishTooltip')}
            >
              <UploadCloud className="mr-2 h-4 w-4" aria-hidden />
              {t('extraction', 'configPublishButton')}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('extraction', 'configPublishTooltip')}</TooltipContent>
      </Tooltip>
    </>
  );
}
