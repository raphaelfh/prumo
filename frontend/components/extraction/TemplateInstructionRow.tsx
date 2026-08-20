import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  useTemplateInstruction,
  useUpdateTemplateInstruction,
} from '@/hooks/extraction/useTemplateInstruction';
import { t } from '@/lib/copy';
import { cn } from '@/lib/utils';

const CUSTOMIZE_SLOT = /\[customize:[^\]]*\]/g;

function customizeSlotCount(value: string | null | undefined): number {
  return value ? (value.match(CUSTOMIZE_SLOT) ?? []).length : 0;
}

interface TemplateInstructionRowProps {
  projectId: string;
  templateId: string;
}

/**
 * Config "row zero" (spec Phase A §4): the template-level general AI
 * instruction. Collapsed = one-line preview; expanded = editor. The save
 * PUT stages a draft edit (B-4): the text reaches prompts only when the
 * manager presses Publish.
 */
export function TemplateInstructionRow({
  projectId,
  templateId,
}: TemplateInstructionRowProps) {
  const { data, isLoading } = useTemplateInstruction(projectId, templateId);
  const update = useUpdateTemplateInstruction(projectId, templateId);
  // null = collapsed; a string = the editor is open with that draft.
  const [draft, setDraft] = useState<string | null>(null);
  const expanded = draft !== null;

  if (isLoading || !data) {
    return <Skeleton className="h-12 rounded-md border" />;
  }

  const value = data.llm_template_instruction ?? '';
  const hasOrigin = data.default_instruction != null;
  const isEdited = hasOrigin && value !== '' && value !== data.default_instruction;
  const slotCount = customizeSlotCount(data.llm_template_instruction);

  const save = () => {
    if (draft === null) return;
    const normalized = draft.trim() === '' ? null : draft;
    update.mutate(normalized, {
      onSuccess: () => {
        toast.success(t('extraction', 'instructionSavedToast'));
        setDraft(null);
      },
      onError: () => {
        toast.error(t('extraction', 'errors_saveInstruction'));
      },
    });
  };

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setDraft(expanded ? null : value)}
        className="flex h-12 w-full items-center gap-2 rounded-md px-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={expanded}
      >
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-medium">
          {t('extraction', 'instructionTitle')}
        </span>
        {!expanded ? (
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {value === '' ? t('extraction', 'instructionEmpty') : value}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {slotCount > 0 && (
          <Badge
            variant="outline"
            data-testid="instruction-customize-chip"
            className="shrink-0 border-warning/50 bg-warning/10 text-warning"
          >
            {t('extraction', 'instructionCustomizeChip').replace(
              '{{n}}',
              String(slotCount),
            )}
          </Badge>
        )}
        {isEdited && (
          <Badge variant="secondary" className="shrink-0">
            {t('extraction', 'instructionEditedBadge')}
          </Badge>
        )}
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {draft !== null && (
        <div className="space-y-2 border-t px-4 py-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('extraction', 'instructionPlaceholder')}
            maxLength={4000}
            rows={Math.min(12, Math.max(4, draft.split('\n').length + 1))}
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            {draft.length > 1600 && (
              <span className="text-xs text-muted-foreground">
                {t('extraction', 'instructionCounter').replace(
                  '{{n}}',
                  String(draft.length),
                )}
              </span>
            )}
            <span className="flex-1" />
            {hasOrigin && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDraft(data.default_instruction ?? '')}
              >
                {t('extraction', 'instructionResetDefault')}
              </Button>
            )}
            {!hasOrigin && draft === '' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft(t('extraction', 'instructionSuggestedDefault'))
                }
              >
                {t('extraction', 'instructionInsertDefault')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(null)}
            >
              {t('extraction', 'instructionCancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={update.isPending || draft === value}
            >
              {t('extraction', 'instructionSave')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
