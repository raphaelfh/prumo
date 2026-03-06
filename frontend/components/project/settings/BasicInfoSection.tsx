/**
 * Basic project info section — name, description, review type.
 */

import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Badge} from '@/components/ui/badge';
import {SettingsSection, SettingsField, SettingsCard} from '@/components/settings';
import type {Project, ReviewType} from '@/types/project';
import {REVIEW_TYPES} from '@/types/project';
import {t} from '@/lib/copy';

interface BasicInfoSectionProps {
    project: Pick<Project, 'name' | 'description' | 'review_type'>;
    onChange: (updates: Partial<Pick<Project, 'name' | 'description' | 'review_type'>>) => void;
}

export function BasicInfoSection({ project, onChange }: BasicInfoSectionProps) {
    const currentReviewType = (project.review_type || 'interventional') as ReviewType;

  return (
      <SettingsSection
          title={t('project', 'basicSectionTitle')}
          description={t('project', 'basicSectionDesc')}
      >
          <SettingsCard
              title={t('project', 'basicCardIdentification')}
              description={t('project', 'basicCardIdentificationDesc')}
          >
              <div className="space-y-4">
                  <SettingsField
                      label={t('project', 'basicProjectNameLabel')}
                      htmlFor="name"
                      required
                      hint={t('project', 'basicProjectNameHint')}
                  >
            <Input
              id="name"
              value={project.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder={t('project', 'basicProjectNamePlaceholder')}
              required
              className="max-w-2xl text-[13px] h-9"
            />
                  </SettingsField>
                  <SettingsField
                      label={t('project', 'basicDescriptionLabel')}
                      htmlFor="description"
                      hint={t('project', 'basicDescriptionHint')}
                  >
            <Textarea
              id="description"
              value={project.description ?? ''}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder={t('project', 'basicDescriptionPlaceholder')}
              rows={4}
              className="resize-none text-[13px]"
            />
                  </SettingsField>
              </div>
          </SettingsCard>

          <SettingsCard
              title={t('project', 'basicReviewTypeCardTitle')}
              description={t('project', 'basicReviewTypeCardDesc')}
          >
              <div className="space-y-4">
                  <SettingsField
                      label={t('project', 'basicReviewTypeLabel')}
                      htmlFor="review_type"
                      required
                      hint={REVIEW_TYPES[currentReviewType].description}
                  >
            <Select
              value={currentReviewType}
              onValueChange={(value: ReviewType) => onChange({ review_type: value })}
            >
                <SelectTrigger id="review_type" className="max-w-md h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REVIEW_TYPES) as ReviewType[]).map((type) => (
                  <SelectItem key={type} value={type}>
                    <div className="flex items-center gap-2">
                      <span>{REVIEW_TYPES[type].label}</span>
                      {REVIEW_TYPES[type].badge && (
                          <Badge variant="secondary" className="text-[11px]">
                          {REVIEW_TYPES[type].badge}
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
                  </SettingsField>

          {currentReviewType === 'predictive_model' && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-start gap-2">
                      <Badge variant="default" className="text-[11px]">PICOTS</Badge>
                <div className="flex-1">
                    <p className="text-[13px] font-medium mb-0.5">{t('project', 'basicPicotsEnabledTitle')}</p>
                    <p className="text-[12px] text-muted-foreground/70">
                        {t('project', 'basicPicotsEnabledDesc')}
                  </p>
                </div>
              </div>
            </div>
          )}
              </div>
          </SettingsCard>
      </SettingsSection>
  );
}
