/**
 * User settings.
 *
 * Renders inside AppShell, so it owns neither chrome nor a back affordance —
 * the breadcrumb names the page and the sidebar is the way back. The 224px
 * rail is page sub-navigation, not a second sidebar: no panel background, no
 * panel border, and below `md` it becomes a horizontal scrolling tab strip.
 */

import {useState} from 'react';
import {useSearchParams} from 'react-router';
import {cn} from '@/lib/utils';
import {PageHeader} from '@/components/patterns/PageHeader';
import {Plug, Shield, User} from 'lucide-react';
import {ProfileSection} from '@/components/user/ProfileSection';
import {SecuritySection} from '@/components/user/SecuritySection';
import {IntegrationsSection} from '@/components/user/IntegrationsSection';
import {t} from '@/lib/copy';

type TabId = 'profile' | 'security' | 'integrations';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
  description: string;
}

const TABS: Tab[] = [
  {id: 'profile', label: t('user', 'tabProfile'), icon: User, description: t('user', 'tabProfileDesc')},
  {id: 'security', label: t('user', 'tabSecurity'), icon: Shield, description: t('user', 'tabSecurityDesc')},
  {id: 'integrations', label: t('user', 'tabIntegrations'), icon: Plug, description: t('user', 'tabIntegrationsDesc')},
];

const VALID_TAB_IDS: TabId[] = ['profile', 'security', 'integrations'];

export default function UserSettings() {
    const [searchParams, setSearchParams] = useSearchParams();
    const tabFromUrl = searchParams.get('tab');
    const initialTab: TabId =
        tabFromUrl && VALID_TAB_IDS.includes(tabFromUrl as TabId)
            ? (tabFromUrl as TabId)
            : 'profile';
    const [activeTab, setActiveTab] = useState<TabId>(initialTab);

    // Sync tab when URL changes (e.g. direct link to ?tab=integrations) —
    // adjusted during render instead of via effect to avoid a cascading render.
    const [prevSearchParams, setPrevSearchParams] = useState(searchParams);
    if (searchParams !== prevSearchParams) {
        setPrevSearchParams(searchParams);
        const tab = searchParams.get('tab');
        if (tab && VALID_TAB_IDS.includes(tab as TabId) && tab !== activeTab) {
            setActiveTab(tab as TabId);
        }
    }

    const handleTabChange = (tabId: TabId) => {
        setActiveTab(tabId);
        setSearchParams({tab: tabId}, {replace: true});
    };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileSection />;
      case 'security':
        return <SecuritySection />;
      case 'integrations':
        return <IntegrationsSection />;
    }
  };

  const activeTabMeta = TABS.find((tab) => tab.id === activeTab)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
        <PageHeader description={activeTabMeta.description} className="px-4 lg:px-6" />

        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden md:flex-row">
            <nav
                role="tablist"
                aria-label={t('user', 'settingsAriaSections')}
                className={cn(
                    'flex shrink-0 gap-1 overflow-x-auto border-b border-border/40 px-4 py-2',
                    'md:w-56 md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:px-2 md:py-3 lg:px-3',
                )}
            >
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleTabChange(tab.id)}
                    type="button"
                    className={cn(
                        'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors duration-75',
                        'hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-1',
                        'md:w-full',
                        isActive ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    )}
                  >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5}/>
                      {tab.label}
                  </button>
                );
              })}
            </nav>

            <main className="min-w-0 flex-1 overflow-y-auto px-4 py-3 lg:px-6">
                <div className="w-full max-w-3xl lg:max-w-4xl">
                    {renderTabContent()}
                </div>
            </main>
      </div>
    </div>
  );
}
