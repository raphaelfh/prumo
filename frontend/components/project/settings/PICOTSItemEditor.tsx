/**
 * One PICOTS slot as a settings row: the description, then — where the slot
 * shows criteria — the inclusion and exclusion lists (TagInput), in the same
 * value cell with no separator (spec 2026-09-13 §4.3).
 */

import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {SettingsRow, TagInput} from '@/components/settings';
import {t} from '@/lib/copy';

/** One PICOTS slot. Declared here now — the section that used to own this
 * type no longer edits slots, and the editor is the only shape authority. */
export interface PICOTSItem {
  description?: string;
  inclusion?: string[];
  exclusion?: string[];
}

interface PICOTSItemEditorProps {
  /** The server's wording for the slot — the row label. */
  label: string;
  fieldKey: string;
  data: PICOTSItem;
  /** Row hint behind the ⓘ; omit when the label carries the meaning. */
  hint?: string;
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
  hint,
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
  const inclusionLabel = t('project', 'picotsInclusionCriteriaLabel');
  const exclusionLabel = t('project', 'picotsExclusionCriteriaLabel');

  return (
    <SettingsRow label={label} htmlFor={`${fieldKey}_description`} hint={hint} align="start">
      {({describedBy}) => (
        <div className="space-y-2">
          <Textarea
            id={`${fieldKey}_description`}
            variant="quiet"
            value={data.description ?? ''}
            onChange={(e) => onUpdate(fieldKey, 'description', e.target.value)}
            placeholder={descriptionPlaceholder}
            rows={2}
            aria-describedby={describedBy}
            className="resize-none"
          />

          {withInclusion && (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2 px-2">
                <Label htmlFor={`${fieldKey}_inclusion`} className="text-xs font-medium text-muted-foreground">
                  {inclusionLabel}
                </Label>
                <span className="text-[11px] text-muted-foreground">{t('project', 'picotsCriteriaOptional')}</span>
              </div>
              <TagInput
                id={`${fieldKey}_inclusion`}
                items={inclusion}
                onAdd={(value) => onAddItem(fieldKey, 'inclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'inclusion', index)}
                placeholder={t('project', 'picotsAddInclusionPlaceholder')}
                addLabel={t('common', 'addToLabel').replace('{{label}}', inclusionLabel)}
                variant="list"
                listVariant="green"
              />
            </div>
          )}

          {withExclusion && (
            <div className="space-y-1">
              <div className="flex items-baseline gap-2 px-2">
                <Label htmlFor={`${fieldKey}_exclusion`} className="text-xs font-medium text-muted-foreground">
                  {exclusionLabel}
                </Label>
                <span className="text-[11px] text-muted-foreground">{t('project', 'picotsCriteriaOptional')}</span>
              </div>
              <TagInput
                id={`${fieldKey}_exclusion`}
                items={exclusion}
                onAdd={(value) => onAddItem(fieldKey, 'exclusion', value)}
                onRemove={(index) => onRemoveItem(fieldKey, 'exclusion', index)}
                placeholder={t('project', 'picotsAddExclusionPlaceholder')}
                addLabel={t('common', 'addToLabel').replace('{{label}}', exclusionLabel)}
                variant="list"
                listVariant="red"
              />
            </div>
          )}
        </div>
      )}
    </SettingsRow>
  );
}
