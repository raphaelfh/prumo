/**
 * Advanced settings — one flat group of rows (keywords, eligibility, study types, PDF parsing), then the Danger zone.
 */

import {useState} from 'react';
import {useNavigate} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import {Textarea} from '@/components/ui/textarea';
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
import {Trash2} from 'lucide-react';
import {deleteProject} from '@/services/projectSettingsService';
import {ApiError} from '@/integrations/api/client';
import {useAuth} from '@/contexts/AuthContext';
import {projectsListKey} from '@/hooks/useProjectsQuery';
import {useMyConnections} from '@/hooks/user/useLlmConnections';
import {useProjectConnections} from '@/hooks/project/useProjectConnections';
import {toast} from 'sonner';
import {SettingsGroup, SettingsPage, SettingsRow, TagInput} from '@/components/settings';
import type {EligibilityCriteria, StudyDesign} from '@/types/project';
import type {Json} from '@/integrations/supabase/types';
import {t} from '@/lib/copy';
import {HighQualityParsingToggle} from './HighQualityParsingToggle';

// AdvancedProjectShape mirrors the JSON columns of Project using Json (not narrower
// domain types) so that Project is assignable here without narrowing casts.
interface AdvancedProjectShape {
  name?: string;
  eligibility_criteria: Json;
  study_design: Json;
  review_keywords: Json;
  settings: Json;
}

interface AdvancedSettingsSectionProps {
    project: AdvancedProjectShape;
    onChange: (updates: Partial<AdvancedProjectShape>) => void;
    projectId: string;
    /** Disables the parsing toggle for non-managers. Defaults to false. */
    isManager?: boolean;
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
                                            isManager = false,
                                        }: AdvancedSettingsSectionProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {user} = useAuth();

  // --- Parsing toggle state ---
  // Derive the current parser type synchronously from the loaded project settings
  // (project.settings is the JSONB column, already present from select('*')).
  const currentParserType: 'standard' | 'llamaparse' =
    (project.settings as { parsing?: { type?: 'standard' | 'llamaparse' } } | null | undefined)
      ?.parsing?.type === 'llamaparse'
      ? 'llamaparse'
      : 'standard';
  // §2: a llama_cloud connection satisfies parsing — the viewer's own, or
  // (manager only: the API gates the list) the project's shared one.
  const myConnections = useMyConnections();
  const projectConnections = useProjectConnections(isManager ? projectId : null);
  const hasLlamaCloud = (rows: {provider: string; has_api_key: boolean}[] | undefined) =>
    Boolean(rows?.some((c) => c.provider === 'llama_cloud' && c.has_api_key));
  const hasLlamaCloudKey = hasLlamaCloud(myConnections.data) || hasLlamaCloud(projectConnections.data);

    const eligibility = ensureEligibility(project.eligibility_criteria);
    const studyDesign = ensureStudyDesign(project.study_design);
    const keywords = ensureStringArray(project.review_keywords);
    const inclusion = eligibility.inclusion || [];
    const exclusion = eligibility.exclusion || [];
    const studyTypes = studyDesign.types || [];

  const addTo = (label: string) => t('common', 'addToLabel').replace('{{label}}', label);
  const keywordsLabel = t('project', 'advancedCardKeywordsTitle');
  const inclusionLabel = t('project', 'advancedInclusionLabel');
  const exclusionLabel = t('project', 'advancedExclusionLabel');
  const studyTypesLabel = t('project', 'advancedCardStudyTypesTitle');

  const handleDeleteProject = async () => {
    setIsDeleting(true);
    const result = await deleteProject(projectId);
    setIsDeleting(false);

    if (!result.ok) {
      console.error('Error deleting project:', result.error);
      if (result.error instanceof ApiError && result.error.status === 403) {
        toast.error(t('project', 'advancedErrorDeletingMessage'));
        return;
      }
      toast.error(`${t('project', 'advancedErrorDeleting')}: ${result.error.message ?? ''}`);
      return;
    }
    toast.success(t('project', 'advancedProjectDeleted'));
    // The hub, the sidebar switcher and the breadcrumb all read this one entry.
    if (user?.id) void queryClient.invalidateQueries({queryKey: projectsListKey(user.id)});
    navigate('/');
  };

  return (
    <SettingsPage>
      <SettingsGroup>
        <SettingsRow label={keywordsLabel} htmlFor="advanced-keywords" hint={t('project', 'advancedCardKeywordsDesc')} align="start">
          {({describedBy}) => (
            <TagInput
              id="advanced-keywords"
              aria-describedby={describedBy}
              addLabel={addTo(keywordsLabel)}
              items={keywords}
              onAdd={(value) => onChange({review_keywords: [...keywords, value]})}
              onRemove={(index) => onChange({review_keywords: keywords.filter((_, i) => i !== index)})}
              placeholder={t('project', 'advancedKeywordsPlaceholder')}
              variant="badge"
            />
          )}
        </SettingsRow>

        <SettingsRow label={inclusionLabel} htmlFor="advanced-inclusion" align="start">
          <TagInput
            id="advanced-inclusion"
            addLabel={addTo(inclusionLabel)}
            items={inclusion}
            onAdd={(value) => onChange({eligibility_criteria: {...eligibility, inclusion: [...inclusion, value]}})}
            onRemove={(index) =>
              onChange({eligibility_criteria: {...eligibility, inclusion: inclusion.filter((_, i) => i !== index)}})
            }
            placeholder={t('project', 'advancedInclusionPlaceholder')}
            variant="list"
            listVariant="neutral"
          />
        </SettingsRow>

        <SettingsRow label={exclusionLabel} htmlFor="advanced-exclusion" align="start">
          <TagInput
            id="advanced-exclusion"
            addLabel={addTo(exclusionLabel)}
            items={exclusion}
            onAdd={(value) => onChange({eligibility_criteria: {...eligibility, exclusion: [...exclusion, value]}})}
            onRemove={(index) =>
              onChange({eligibility_criteria: {...eligibility, exclusion: exclusion.filter((_, i) => i !== index)}})
            }
            placeholder={t('project', 'advancedExclusionPlaceholder')}
            variant="list"
            listVariant="neutral"
          />
        </SettingsRow>

        <SettingsRow label={t('project', 'advancedAdditionalNotesLabel')} htmlFor="eligibility_notes" align="start">
          <Textarea
            id="eligibility_notes"
            variant="quiet"
            value={eligibility.notes ?? ''}
            onChange={(e) => onChange({eligibility_criteria: {...eligibility, notes: e.target.value}})}
            placeholder={t('project', 'advancedEligibilityNotesPlaceholder')}
            rows={3}
            className="resize-none"
          />
        </SettingsRow>

        <SettingsRow label={studyTypesLabel} htmlFor="advanced-study-types" hint={t('project', 'advancedCardStudyTypesDesc')} align="start">
          {({describedBy}) => (
            <TagInput
              id="advanced-study-types"
              aria-describedby={describedBy}
              addLabel={addTo(studyTypesLabel)}
              items={studyTypes}
              onAdd={(value) => onChange({study_design: {...studyDesign, types: [...studyTypes, value]}})}
              onRemove={(index) =>
                onChange({study_design: {...studyDesign, types: studyTypes.filter((_, i) => i !== index)}})
              }
              placeholder={t('project', 'advancedStudyTypesPlaceholder')}
              variant="badge"
            />
          )}
        </SettingsRow>

        <SettingsRow label={t('project', 'advancedDesignNotesLabel')} htmlFor="study_design_notes" align="start">
          <Textarea
            id="study_design_notes"
            variant="quiet"
            value={studyDesign.notes ?? ''}
            onChange={(e) => onChange({study_design: {...studyDesign, notes: e.target.value}})}
            placeholder={t('project', 'advancedDesignNotesPlaceholder')}
            rows={3}
            className="resize-none"
          />
        </SettingsRow>

        <HighQualityParsingToggle
          projectId={projectId}
          currentType={currentParserType}
          hasLlamaCloudKey={hasLlamaCloudKey}
          disabled={!isManager}
        />
      </SettingsGroup>

      <SettingsGroup title={t('project', 'advancedCardDangerTitle')} tone="danger">
        <SettingsRow label={t('project', 'advancedDeleteProjectHeading')} hint={t('project', 'advancedDeleteProjectWarning')}>
          {({describedBy}) => (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" aria-describedby={describedBy} className="w-fit">
                  <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
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
                  <AlertDialogAction onClick={handleDeleteProject} disabled={isDeleting} variant="destructive">
                    {isDeleting ? t('project', 'advancedDeleting') : t('project', 'advancedConfirmDeleteButton')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
