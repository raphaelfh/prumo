/**
 * User Settings page
 * Layout with tabs for Profile, Security and Integrations
 */

import {useEffect, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {PageHeader} from '@/components/patterns/PageHeader';
import {ArrowLeft, Plug, Shield, User} from 'lucide-react';
import {ProfileSection} from '@/components/user/ProfileSection';
import {SecuritySection} from '@/components/user/SecuritySection';
import {IntegrationsSection} from '@/components/user/IntegrationsSection';

type TabId = 'profile' | 'security' | 'integrations';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
  description: string;
}

const TABS: Tab[] = [
  {
    id: 'profile',
      label: 'Profile',
    icon: User,
      description: 'Personal information and avatar',
  },
  {
    id: 'security',
      label: 'Security',
    icon: Shield,
      description: 'Password and authentication',
  },
  {
    id: 'integrations',
      label: 'Integrations',
    icon: Plug,
      description: 'External services and APIs',
  },
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
  const navigate = useNavigate();

    // Sync tab when URL changes (e.g. direct link to ?tab=integrations)
    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab && VALID_TAB_IDS.includes(tab as TabId)) {
            setActiveTab(tab as TabId);
        }
    }, [searchParams]);

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

  const activeTabMeta = TABS.find(t => t.id === activeTab)!;

  return (
    <div className="h-screen flex flex-col bg-background">
        <PageHeader
            leading={
                <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Go back">
                    <ArrowLeft className="h-4 w-4 mr-2"/>
                    Back
                </Button>
            }
            title="Settings"
            description={activeTabMeta.description}
        />

        <div className="flex-1 overflow-hidden flex w-full">
            <aside
                className="w-56 flex-shrink-0 border-r border-border/40 bg-[#fafafa] dark:bg-[#0c0c0c] overflow-y-auto">
                <nav role="tablist" aria-label="Settings sections" className="py-4 px-2 space-y-0.5">
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

            <main className="flex-1 overflow-y-auto bg-background min-w-0">
                <div className="w-full mx-auto px-4 py-6 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
                    <div className="w-full max-w-3xl lg:max-w-4xl">
                {renderTabContent()}
              </div>
            </div>
            </main>
      </div>
    </div>
  );
}
