/**
 * Project settings - Tab layout (Plane/Linear style).
 * Data and persistence delegated to useProjectSettings.
 */

import {useState} from 'react';
import {useSearchParams} from 'react-router';
import {Bot, FileText, Info, MessageSquareText, Save, Settings as SettingsIcon, ShieldCheck, Users} from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
import {cn} from '@/lib/utils';
import {PageHeader} from '@/components/patterns/PageHeader';
import {useProjectSettings} from '@/hooks/useProjectSettings';
import {useProjectMemberRole} from '@/hooks/useProjectMemberRole';

import {BasicInfoSection} from './settings/BasicInfoSection';
import {ReviewDetailsSection} from './settings/ReviewDetailsSection';
import {ReviewQuestionSection} from './settings/ReviewQuestionSection';
import {AiEngineSection} from './settings/AiEngineSection';
import {TeamMembersSection} from './settings/TeamMembersSection';
import {AdvancedSettingsSection} from './settings/AdvancedSettingsSection';
import {ReviewConsensusSection} from './settings/ReviewConsensusSection';
import {t} from '@/lib/copy';

export type SectionId =
  | 'basic'
  | 'review'
  | 'review-question'
  | 'ai-engine'
  | 'team'
  | 'consensus'
  | 'advanced';

interface SectionConfig {
  id: SectionId;
  label: string;
  icon: typeof Info;
}

const SECTIONS: SectionConfig[] = [
    {id: 'basic', label: t('project', 'tabBasic'), icon: Info},
    {id: 'review', label: t('project', 'tabReview'), icon: FileText},
    {
        id: 'review-question',
        label: t('project', 'tabReviewQuestion'),
        icon: MessageSquareText,
    },
    {id: 'ai-engine', label: t('project', 'tabAiEngine'), icon: Bot},
    {id: 'team', label: t('project', 'tabTeam'), icon: Users},
    {id: 'consensus', label: t('consensus', 'tabConsensus'), icon: ShieldCheck},
    {id: 'advanced', label: t('project', 'tabAdvanced'), icon: SettingsIcon},
];

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

/** The URL owns the section: read every render, never mirrored into state. */
function parseSection(value: string | null): SectionId {
  return value && SECTION_IDS.has(value) ? (value as SectionId) : 'basic';
}

interface ProjectSettingsProps {
    projectId: string;
}

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
    const [searchParams, setSearchParams] = useSearchParams();
    const activeSection = parseSection(searchParams.get('section'));
    const selectSection = (id: SectionId) =>
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('section', id);
                return next;
            },
            {replace: true},
        );
    const {project, loading, hasUnsavedChanges, updateProject, saveProject} = useProjectSettings(projectId);
    const {isManager} = useProjectMemberRole(projectId);
    const [reviewQuestionDirty, setReviewQuestionDirty] = useState(false);
    const [pendingSection, setPendingSection] = useState<SectionId | null>(null);
    const requestSection = (id: SectionId) => {
        if (id === activeSection) return;
        if (activeSection === 'review-question' && reviewQuestionDirty) {
            setPendingSection(id);
            return;
        }
        selectSection(id);
    };
    // The section can change outside the rail (e.g. the sidebar's `?tab=settings` link, which
    // drops `section`), leaving a stale dirty flag with nothing left to discard. Render-phase
    // reset: only while the discard confirm is not pending (activeSection stays 'review-question'
    // while pending, so this does not fire mid-discard).
    if (activeSection !== 'review-question' && reviewQuestionDirty) setReviewQuestionDirty(false);

  if (loading && !project) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
            <div
                className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"/>
            <p className="text-[13px] text-muted-foreground">{t('project', 'settingsLoading')}</p>
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="h-full flex flex-col bg-background">
        {/* Always mounted, like UserSettings: the row is reserved from the first paint, so the
            first edit only fills the actions slot instead of pushing the page down. */}
        <PageHeader
            className="px-4 lg:px-6"
            actions={
                hasUnsavedChanges && (
                    <Button onClick={saveProject} disabled={loading} size="sm" className="text-[13px]">
                        <Save className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                        {loading ? t('project', 'settingsSaving') : t('project', 'settingsSaveChanges')}
                    </Button>
                )
            }
        />

      <div className="flex-1 flex overflow-hidden">
          <aside className="w-56 shrink-0 overflow-y-auto border-r border-border/40">
              <nav className="py-4 px-2 space-y-0.5">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => requestSection(section.id)}
                  className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] font-medium transition-colors duration-75',
                      'hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-1',
                      isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
                  )}
                >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5}/>
                    {section.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto bg-background">
            <div className="w-full p-2">
                {activeSection === 'basic' && (
                    <BasicInfoSection project={project} onChange={updateProject}/>
                )}
                {activeSection === 'review' && (
                    <ReviewDetailsSection project={project} onChange={updateProject}/>
                )}
                {activeSection === 'review-question' && (
                    <ReviewQuestionSection projectId={projectId} onDirtyChange={setReviewQuestionDirty}/>
                )}
                {activeSection === 'ai-engine' && <AiEngineSection projectId={projectId}/>}
                {activeSection === 'team' && <TeamMembersSection projectId={projectId}/>}
                {activeSection === 'consensus' && (
                    <ReviewConsensusSection projectId={projectId} />
                )}
                {activeSection === 'advanced' && (
                    <AdvancedSettingsSection
                        project={project}
                        onChange={updateProject}
                        projectId={projectId}
                        isManager={isManager}
                    />
                )}
          </div>
        </main>
      </div>

      <AlertDialog open={pendingSection !== null} onOpenChange={(open) => !open && setPendingSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('project', 'settingsDiscardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('project', 'settingsDiscardBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('project', 'settingsDiscardCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const next = pendingSection;
                setPendingSection(null);
                setReviewQuestionDirty(false);
                if (next) selectSection(next);
              }}
            >
              {t('project', 'settingsDiscardConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
