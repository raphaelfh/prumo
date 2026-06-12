/**
 * Advanced settings section — blind mode, keywords, eligibility, study types, danger zone.
 */

import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Switch} from '@/components/ui/switch';
import {Button} from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {AlertTriangle as _AlertTriangle, Trash2} from 'lucide-react';
import {deleteProject} from '@/services/projectSettingsService';
import {toast} from 'sonner';
import {SettingsSection, SettingsCard, TagInput} from '@/components/settings';
import type {EligibilityCriteria, StudyDesign} from '@/types/project';
import type {Json} from '@/integrations/supabase/types';
import {t} from '@/lib/copy';

// AdvancedProjectShape mirrors the JSON columns of Project using Json (not narrower
// domain types) so that Project is assignable here without narrowing casts.
interface AdvancedProjectShape {
  name?: string;
  settings: Json;
  eligibility_criteria: Json;
  study_design: Json;
  review_keywords: Json;
}

interface AdvancedSettingsSectionProps {
    project: AdvancedProjectShape;
    onChange: (updates: Partial<AdvancedProjectShape>) => void;
  projectId: string;
}

function ensureSettings(v: Json | null): { blind_mode?: boolean } {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return v as { blind_mode?: boolean };
    }
    return {};
}

function ensureEligibility(v: Json | null): EligibilityCriteria {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return v as unknown as EligibilityCriteria;
    }
    return { inclusion: [], exclusion: [], notes: '' };
}

function ensureStudyDesign(v: Json | null): StudyDesign {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return v as unknown as StudyDesign;
    }
    return { types: [], notes: '' };
}

function ensureStringArray(v: unknown): string[] {
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
    return [];
}

export function AdvancedSettingsSection({
                                            project,
                                            onChange,
                                            projectId,
                                        }: AdvancedSettingsSectionProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();

  const settings = ensureSettings(project.settings);
    const eligibility = ensureEligibility(project.eligibility_criteria);
    const studyDesign = ensureStudyDesign(project.study_design);
    const keywords = ensureStringArray(project.review_keywords);
    const inclusion = eligibility.inclusion || [];
    const exclusion = eligibility.exclusion || [];
    const studyTypes = studyDesign.types || [];

  const handleBlindModeToggle = (checked: boolean) => {
      onChange({settings: {...settings, blind_mode: checked}});
  };

  const handleDeleteProject = async () => {
    setIsDeleting(true);
    const result = await deleteProject(projectId);
    setIsDeleting(false);

    if (!result.ok) {
      console.error('Error deleting project:', result.error);
      toast.error(`${t('project', 'advancedErrorDeleting')}: ${result.error.message ?? ''}`);
      return;
    }
    if (!result.data.deleted) {
      toast.error(t('project', 'advancedErrorDeletingMessage'));
      return;
    }
    toast.success(t('project', 'advancedProjectDeleted'));
    navigate('/');
  };

  return (
      <SettingsSection
          title={t('project', 'advancedSectionTitle')}
          description={t('project', 'advancedSectionDesc')}
      >
          <SettingsCard
              title={t('project', 'advancedCardBlindTitle')}
              description={t('project', 'advancedCardBlindDesc')}
          >
              <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                      <Label htmlFor="blind-mode" className="text-[13px] font-medium">
                          {t('project', 'advancedEnableBlindLabel')}
                      </Label>
                      <p className="text-[12px] text-muted-foreground/70">
                          {t('project', 'advancedEnableBlindHint')}
                      </p>
                  </div>
                  <Switch
                      id="blind-mode"
                      checked={settings.blind_mode ?? false}
                      onCheckedChange={handleBlindModeToggle}
                  />
              </div>
          </SettingsCard>

          <SettingsCard
              title={t('project', 'advancedCardKeywordsTitle')}
              description={t('project', 'advancedCardKeywordsDesc')}
          >
              <TagInput
                  items={keywords}
                  onAdd={(value) => onChange({review_keywords: [...keywords, value]})}
                  onRemove={(index) =>
                      onChange({review_keywords: keywords.filter((_, i) => i !== index)})
                  }
                  placeholder={t('project', 'advancedKeywordsPlaceholder')}
                  variant="badge"
              />
          </SettingsCard>

          <SettingsCard
              title={t('project', 'advancedCardEligibilityTitle')}
              description={t('project', 'advancedCardEligibilityDesc')}
          >
              <div className="space-y-4">
                  <div>
                      <Label
                          className="text-[13px] font-medium mb-2 block">{t('project', 'advancedInclusionLabel')}</Label>
                      <TagInput
                          items={inclusion}
                          onAdd={(value) =>
                              onChange({
                                  eligibility_criteria: {
                                      ...eligibility,
                                      inclusion: [...inclusion, value],
                                  },
                              })
                          }
                          onRemove={(index) =>
                              onChange({
                                  eligibility_criteria: {
                                      ...eligibility,
                                      inclusion: inclusion.filter((_, i) => i !== index),
                                  },
                              })
                          }
                          placeholder={t('project', 'advancedInclusionPlaceholder')}
                          variant="list"
                          listVariant="neutral"
            />
          </div>
                  <div>
                      <Label
                          className="text-[13px] font-medium mb-2 block">{t('project', 'advancedExclusionLabel')}</Label>
                      <TagInput
                          items={exclusion}
                          onAdd={(value) =>
                              onChange({
                                  eligibility_criteria: {
                                      ...eligibility,
                                      exclusion: [...exclusion, value],
                                  },
                              })
                          }
                          onRemove={(index) =>
                              onChange({
                                  eligibility_criteria: {
                                      ...eligibility,
                                      exclusion: exclusion.filter((_, i) => i !== index),
                                  },
                              })
                          }
                          placeholder={t('project', 'advancedExclusionPlaceholder')}
                          variant="list"
                          listVariant="neutral"
                      />
                  </div>
                  <div>
                      <Label htmlFor="eligibility_notes" className="text-[13px] font-medium mb-2 block">
                          {t('project', 'advancedAdditionalNotesLabel')}
                      </Label>
            <Textarea
              id="eligibility_notes"
              value={eligibility.notes ?? ''}
              onChange={(e) =>
                  onChange({
                      eligibility_criteria: {...eligibility, notes: e.target.value},
                  })
              }
              placeholder={t('project', 'advancedEligibilityNotesPlaceholder')}
              rows={3}
              className="resize-none text-[13px]"
            />
          </div>
              </div>
          </SettingsCard>

          <SettingsCard
              title={t('project', 'advancedCardStudyTypesTitle')}
              description={t('project', 'advancedCardStudyTypesDesc')}
          >
              <div className="space-y-4">
                  <TagInput
                      items={studyTypes}
                      onAdd={(value) =>
                          onChange({
                              study_design: {
                                  ...studyDesign,
                                  types: [...studyTypes, value],
                              },
                          })
                      }
                      onRemove={(index) =>
                          onChange({
                              study_design: {
                                  ...studyDesign,
                                  types: studyTypes.filter((_, i) => i !== index),
                              },
                          })
                      }
                      placeholder={t('project', 'advancedStudyTypesPlaceholder')}
                      variant="badge"
                  />
                  <div>
                      <Label htmlFor="study_design_notes" className="text-[13px] font-medium mb-2 block">
                          {t('project', 'advancedDesignNotesLabel')}
                      </Label>
            <Textarea
              id="study_design_notes"
              value={studyDesign.notes ?? ''}
              onChange={(e) =>
                  onChange({
                      study_design: {...studyDesign, notes: e.target.value},
                  })
              }
              placeholder={t('project', 'advancedDesignNotesPlaceholder')}
              rows={3}
              className="resize-none text-[13px]"
            />
          </div>
              </div>
          </SettingsCard>

          <SettingsCard
              title={t('project', 'advancedCardDangerTitle')}
              description={t('project', 'advancedCardDangerDesc')}
              destructive
          >
              <div className="space-y-3">
                  <h4 className="text-[13px] font-medium text-destructive">{t('project', 'advancedDeleteProjectHeading')}</h4>
                  <p className="text-[12px] text-muted-foreground/70">
                      {t('project', 'advancedDeleteProjectWarning')}
                  </p>
                  <AlertDialog>
                      <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" className="text-[13px]">
                              <Trash2 className="h-4 w-4 mr-2" strokeWidth={1.5}/>
                              {t('project', 'advancedDeleteProjectButton')}
                          </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                          <AlertDialogHeader>
                              <AlertDialogTitle className="text-destructive">
                                  {t('project', 'advancedConfirmDeleteTitle')}
                              </AlertDialogTitle>
                              <AlertDialogDescription className="space-y-2">
                                  <p>
                                      {t('project', 'advancedConfirmDeleteDescription')}{' '}
                                      <strong>&quot;{project.name}&quot;</strong>.
                                  </p>
                                  <p>{t('project', 'advancedConfirmDeleteList')}</p>
                                  <p className="font-medium text-destructive">{t('project', 'advancedConfirmDeleteFinal')}</p>
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                              <AlertDialogCancel>{t('common', 'cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                  onClick={handleDeleteProject}
                                  disabled={isDeleting}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                  {isDeleting ? t('project', 'advancedDeleting') : t('project', 'advancedConfirmDeleteButton')}
                              </AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
              </div>
          </SettingsCard>
      </SettingsSection>
  );
}
