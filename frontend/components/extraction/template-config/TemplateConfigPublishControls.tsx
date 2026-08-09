import {useState} from 'react';
import {RotateCcw, UploadCloud} from 'lucide-react';
import {toast} from 'sonner';

import {TemplateConfigDiffSheet} from '@/components/extraction/template-config/TemplateConfigDiffSheet';
import {TemplateDiscardDialog} from '@/components/extraction/template-config/TemplateDiscardDialog';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {useTemplateConfigStatus} from '@/hooks/extraction/useTemplateConfigStatus';
import {useTemplateInstruction} from '@/hooks/extraction/useTemplateInstruction';
import {useTemplateRepublish} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';

/**
 * The B-4 Draft chip + explicit Publish button (command-bar cluster),
 * plus the B-9c2 Discard button that rewinds the draft.
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
  /** True while the read-only diff sheet is open. Owned by the editor, not
   * here: the grid panel — our sibling — has to close its own inspector
   * Sheet rather than let two modal sheets stack. */
  diffSheetOpen: boolean;
  onDiffSheetOpenChange: (open: boolean) => void;
}

export function TemplateConfigPublishControls({
  projectId,
  templateId,
  diffSheetOpen,
  onDiffSheetOpenChange,
}: TemplateConfigPublishControlsProps) {
  const {data: configStatus} = useTemplateConfigStatus(projectId, templateId);
  const {republish} = useTemplateRepublish(projectId, templateId);
  // D10 — the Discard confirm pane warns about the AI instruction only when
  // there IS one. TemplateInstructionRow mounts this same key alongside us,
  // so the two observers dedupe into one request.
  const {data: instruction} = useTemplateInstruction(projectId, templateId);
  const [publishing, setPublishing] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

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

  // D6 — the four-way Discard tooltip: a REASON when the button is off for
  // a knowable cause, otherwise the plain action description. A status that
  // has not answered yet therefore says what the button does rather than
  // inventing a reason — a loading spinner must not turn into a lie.
  const discardAvailable = configStatus?.discard_available === true;
  const canDiscard = discardAvailable && hasPendingChanges;
  let discardReason:
    | 'discardTooltipNothing'
    | 'discardTooltipNeverPublished'
    | 'discardTooltipBaselineTooOld'
    | null = null;
  if (configStatus != null) {
    if (!hasPendingChanges) {
      discardReason = 'discardTooltipNothing';
    } else if (!discardAvailable) {
      discardReason =
        configStatus.active_version == null
          ? 'discardTooltipNeverPublished'
          : 'discardTooltipBaselineTooOld';
    }
  }
  const discardTooltip = t(
    'templateConfig',
    discardReason ?? 'discardTooltipAction',
  );

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
    // B-9b2a: the draft chip is now the diff sheet's trigger. It was a
    // bare Badge — no role, no accessible name, not reachable by keyboard
    // — so it becomes a real Button wearing the chip's look. The chip
    // content is NOT a nested <Badge>: Badge renders a <div>, and <button>
    // only admits phrasing content. The published-vN chip below stays a
    // Badge — it has no draft to explain.
    chip = (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-full border border-warning/50 bg-warning/10 px-2.5 text-xs font-semibold text-warning hover:bg-warning/20 hover:text-warning"
            onClick={() => onDiffSheetOpenChange(true)}
          >
            {draftChangeCount == null
              ? t('extraction', 'configUnpublishedChanges')
              : (draftChangeCount === 1
                  ? t('templateConfig', 'draftChangeCountOne')
                  : t('templateConfig', 'draftChangeCountOther')
                ).replace('{{n}}', String(draftChangeCount))}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('templateConfig', 'diffTriggerTooltip')}
        </TooltipContent>
      </Tooltip>
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
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setDiscardOpen(true)}
              disabled={!canDiscard}
              aria-label={t('templateConfig', 'discardButtonAria')}
            >
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              {t('templateConfig', 'discardButton')}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{discardTooltip}</TooltipContent>
      </Tooltip>
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
      {/* D4 — mounted per open (portalled, so it adds nothing to the
          command-bar cluster): the phase and every server payload die with
          the dialog, and the next open starts on `confirm`. */}
      {discardOpen && (
        <TemplateDiscardDialog
          projectId={projectId}
          templateId={templateId}
          activeVersion={configStatus?.active_version ?? null}
          draftChangeCount={draftChangeCount}
          instructionPresent={
            (instruction?.llm_template_instruction ?? '').trim() !== ''
          }
          onClose={() => setDiscardOpen(false)}
        />
      )}
      {/* Mounted per open, same as the Discard dialog: the diff read dies
          with the sheet, so the next open asks the server again. */}
      {diffSheetOpen && (
        <TemplateConfigDiffSheet
          projectId={projectId}
          templateId={templateId}
          onClose={() => onDiffSheetOpenChange(false)}
        />
      )}
    </>
  );
}
