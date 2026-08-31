/**
 * The "Project context" chip: the review question, on the config bar.
 *
 * Placement is the whole design. The bar already separates the PROJECT regime
 * from the VERSIONED-TEMPLATE regime with a hairline, and that divider already
 * means what a manager needs to know here: the review question applies to the
 * next run, while the ✨ template instruction ships on Publish. So the chip
 * sits on the project side next to the engine and the divider does the
 * teaching — no caption explaining a distinction the bar already draws.
 *
 * The count is of FILLED slots, the same idiom as the instruction chip's
 * "1 to customize": it makes an empty letter visible before it becomes
 * invisible to the AI.
 */
import {useState} from 'react';
import {Target} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {useAiContext} from '@/hooks/project/useAiContext';
import {AiConfigDialog} from './AiConfigDialog';

const SLOT_TOTAL = 6;

interface ProjectContextChipProps {
  projectId: string;
  /** When the chip sits on a template's config surface, the shared AI
   * dialog it opens also carries that template's instruction tab. */
  templateId?: string;
}

export function ProjectContextChip({
  projectId,
  templateId,
}: ProjectContextChipProps) {
  const [open, setOpen] = useState(false);
  // The instruction tab's parked draft — held by the trigger so it survives
  // the dialog closing (see TemplateInstructionPane).
  const [instructionDraft, setInstructionDraft] = useState<string | null>(null);
  const {data} = useAiContext(projectId);

  const filled = data
    ? Object.values(
        data.picots as unknown as Record<string, {description?: string}>,
      ).filter((slot) => slot?.description).length
    : 0;
  const muted = data?.picots_enabled === false;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="project-context-chip"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Target className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            {/* sr-only, never `hidden`: `hidden` drops the word from the
                accessibility tree, so the control's name would silently lose
                it when the bar narrows. */}
            <span className="sr-only @[52rem]/configbar:not-sr-only">
              {t('aiContext', 'chipLabel')}
            </span>
            <span className="text-[11px] tabular-nums">
              {muted
                ? t('aiContext', 'chipMuted')
                : `${filled}/${SLOT_TOTAL}`}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('aiContext', 'chipTooltip')}</TooltipContent>
      </Tooltip>
      <AiConfigDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        initialTab="picots"
        withModel
        template={
          templateId
            ? {
                id: templateId,
                instructionDraft,
                onInstructionDraftChange: setInstructionDraft,
              }
            : undefined
        }
      />
    </>
  );
}
