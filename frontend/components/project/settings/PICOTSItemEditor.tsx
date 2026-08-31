/**
 * Editor de item PICOTS: descrição + critérios de inclusão e exclusão.
 * Usa TagInput para as listas de critérios.
 */

import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/components/ui/tooltip';
import {HelpCircle} from 'lucide-react';
import {Separator} from '@/components/ui/separator';
import {TagInput} from '@/components/settings';
import {t} from '@/lib/copy';

/** One PICOTS slot. Declared here now — the section that used to own this
 * type no longer edits slots, and the editor is the only shape authority. */
export interface PICOTSItem {
  description?: string;
  inclusion?: string[];
  exclusion?: string[];
}

interface PICOTSItemEditorProps {
  label: string;
  fieldKey: string;
    data: PICOTSItem;
    infoTooltip: string;
  descriptionPlaceholder: string;
  /** Criteria lists are a Population concern — every other slot renders as a
   * plain description box. A slot that already CARRIES criteria still shows
   * the populated list, so stored data is never sent to the AI invisibly. */
  showCriteria: boolean;
    onUpdate: (field: string, subField: string, value: unknown) => void;
  onAddItem: (field: string, arrayField: 'inclusion' | 'exclusion', value: string) => void;
  onRemoveItem: (field: string, arrayField: 'inclusion' | 'exclusion', index: number) => void;
}

export function PICOTSItemEditor({
  label,
  fieldKey,
  data,
  infoTooltip,
  descriptionPlaceholder,
  showCriteria,
  onUpdate,
  onAddItem,
                                     onRemoveItem,
}: PICOTSItemEditorProps) {
    const inclusion = data.inclusion || [];
    const exclusion = data.exclusion || [];
    const withInclusion = showCriteria || inclusion.length > 0;
    const withExclusion = showCriteria || exclusion.length > 0;

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
            <Label htmlFor={`${fieldKey}_description`} className="text-[13px] font-medium">
            {label}
          </Label>
          {infoTooltip !== '' && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full"
                  type="button"
                  aria-label={t('project', 'picotsHelpAria')}
                >
                    <HelpCircle className="text-muted-foreground" strokeWidth={1.5}/>
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                  <p className="text-[13px]">{infoTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          )}
        </div>
        <Textarea
          id={`${fieldKey}_description`}
          value={data.description ?? ''}
          onChange={(e) => onUpdate(fieldKey, 'description', e.target.value)}
          placeholder={descriptionPlaceholder}
          rows={2}
          className="resize-none text-[13px]"
        />
      </div>

      {(withInclusion || withExclusion) && <Separator />}

        {withInclusion && (
        <div>
            <div className="mb-1.5 flex items-baseline gap-2">
                <Label className="text-[13px] font-medium">{t('project', 'picotsInclusionCriteriaLabel')}</Label>
                <span className="text-[11px] text-muted-foreground">{t('project', 'picotsCriteriaOptional')}</span>
            </div>
            <TagInput
                items={inclusion}
                onAdd={(value) => onAddItem(fieldKey, 'inclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'inclusion', index)}
                placeholder={t('project', 'picotsAddInclusionPlaceholder')}
                variant="list"
                listVariant="green"
            />
        </div>
        )}

        {withExclusion && (
        <div>
            <div className="mb-1.5 flex items-baseline gap-2">
                <Label className="text-[13px] font-medium">{t('project', 'picotsExclusionCriteriaLabel')}</Label>
                <span className="text-[11px] text-muted-foreground">{t('project', 'picotsCriteriaOptional')}</span>
            </div>
            <TagInput
                items={exclusion}
                onAdd={(value) => onAddItem(fieldKey, 'exclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'exclusion', index)}
                placeholder={t('project', 'picotsAddExclusionPlaceholder')}
                variant="list"
                listVariant="red"
            />
      </div>
        )}
    </div>
  );
}
