/**
 * Project settings - Tab layout (Plane/Linear style).
 * Data and persistence delegated to useProjectSettings.
 */

import {useState} from 'react';
import {FileText, Info, Save, Settings as SettingsIcon, Users} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {PageHeader} from '@/components/patterns/PageHeader';
import {useProjectSettings} from '@/hooks/useProjectSettings';

import {BasicInfoSection} from './settings/BasicInfoSection';
import {ReviewDetailsSection} from './settings/ReviewDetailsSection';
import {TeamMembersSection} from './settings/TeamMembersSection';
import {AdvancedSettingsSection} from './settings/AdvancedSettingsSection';
import {t} from '@/lib/copy';

export type TabId = 'basic' | 'review' | 'team' | 'advanced';

interface TabConfig {
  id: TabId;
  label: string;
    icon: typeof Info;
  description: string;
}

const TABS: TabConfig[] = [
    {id: 'basic', label: t('project', 'tabBasic'), icon: Info, description: t('project', 'tabBasicDesc')},
    {id: 'review', label: t('project', 'tabReview'), icon: FileText, description: t('project', 'tabReviewDesc')},
    {id: 'team', label: t('project', 'tabTeam'), icon: Users, description: t('project', 'tabTeamDesc')},
    {
        id: 'advanced',
        label: t('project', 'tabAdvanced'),
        icon: SettingsIcon,
        description: t('project', 'tabAdvancedDesc')
    },
];

interface ProjectSettingsProps {
    projectId: string;
}

export function ProjectSettings({ projectId }: ProjectSettingsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('basic');
    const {project, loading, hasUnsavedChanges, updateProject, saveProject} = useProjectSettings(projectId);

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

    const activeTabConfig = TABS.find((t) => t.id === activeTab);

  return (
    <div className="h-full flex flex-col bg-background">
        <PageHeader
            title={hasUnsavedChanges ? t('project', 'settingsTitleUnsaved') : t('project', 'settingsTitle')}
            description={activeTabConfig?.description}
            actions={
                hasUnsavedChanges ? (
                    <Button onClick={saveProject} disabled={loading} size="sm" className="text-[13px]">
                        <Save className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                        {loading ? t('project', 'settingsSaving') : t('project', 'settingsSaveChanges')}
                    </Button>
                ) : undefined
            }
        />

      <div className="flex-1 flex overflow-hidden">
          <aside
              className="w-56 flex-shrink-0 border-r border-border/40 bg-[#fafafa] dark:bg-[#0c0c0c] overflow-y-auto">
              <nav className="py-4 px-2 space-y-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] font-medium transition-colors duration-75',
                      'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-1',
                      isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
                  )}
                >
                    <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.5}/>
                    {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto bg-background">
            <div className="w-full max-w-[1920px] mx-auto px-6 py-6 lg:px-8 lg:py-8">
                {activeTab === 'basic' && (
                    <BasicInfoSection project={project} onChange={updateProject}/>
                )}
                {activeTab === 'review' && (
                    <ReviewDetailsSection project={project} onChange={updateProject}/>
                )}
                {activeTab === 'team' && <TeamMembersSection projectId={projectId}/>}
                {activeTab === 'advanced' && (
                    <AdvancedSettingsSection
                        project={project}
                        onChange={updateProject}
                        projectId={projectId}
                    />
                )}
          </div>
        </main>
      </div>
    </div>
  );
}
