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
import type {PICOTSItem} from './ReviewDetailsSection';
import {t} from '@/lib/copy';

interface PICOTSItemEditorProps {
  label: string;
  fieldKey: string;
    data: PICOTSItem;
    infoTooltip: string;
  descriptionPlaceholder: string;
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
  onUpdate,
  onAddItem,
                                     onRemoveItem,
}: PICOTSItemEditorProps) {
    const inclusion = data.inclusion || [];
    const exclusion = data.exclusion || [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
            <Label htmlFor={`${fieldKey}_description`} className="text-[13px] font-medium">
            {label}
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-full"
                  type="button"
                  aria-label={t('project', 'picotsHelpAria')}
                >
                    <HelpCircle className="h-4 w-4 text-muted-foreground" strokeWidth={1.5}/>
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                  <p className="text-[13px]">{infoTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Textarea
          id={`${fieldKey}_description`}
          value={data.description ?? ''}
          onChange={(e) => onUpdate(fieldKey, 'description', e.target.value)}
          placeholder={descriptionPlaceholder}
          rows={3}
          className="resize-none text-[13px]"
        />
      </div>

      <Separator />

        <div>
            <Label className="text-[13px] font-medium mb-2 block">{t('project', 'picotsInclusionCriteriaLabel')}</Label>
            <TagInput
                items={inclusion}
                onAdd={(value) => onAddItem(fieldKey, 'inclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'inclusion', index)}
                placeholder={t('project', 'picotsAddInclusionPlaceholder')}
                variant="list"
                listVariant="green"
            />
        </div>

        <div>
            <Label className="text-[13px] font-medium mb-2 block">{t('project', 'picotsExclusionCriteriaLabel')}</Label>
            <TagInput
                items={exclusion}
                onAdd={(value) => onAddItem(fieldKey, 'exclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'exclusion', index)}
                placeholder={t('project', 'picotsAddExclusionPlaceholder')}
                variant="list"
                listVariant="red"
            />
      </div>
    </div>
  );
}
