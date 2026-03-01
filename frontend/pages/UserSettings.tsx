/**
 * Página de Configurações do Usuário
 * Layout com tabs para Perfil, Segurança e Integrações
 */

import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {ArrowLeft, Plug, Settings as SettingsIcon, Shield, User} from 'lucide-react';
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
    label: 'Perfil',
    icon: User,
    description: 'Informações pessoais e avatar',
  },
  {
    id: 'security',
    label: 'Segurança',
    icon: Shield,
    description: 'Senha e autenticação',
  },
  {
    id: 'integrations',
    label: 'Integrações',
    icon: Plug,
    description: 'Serviços externos e APIs',
  },
];

export default function UserSettings() {
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const navigate = useNavigate();

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
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-6 py-3">
          <div className="flex items-center gap-4 max-w-[1920px] mx-auto">
            <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(-1)}
                aria-label="Voltar para a página anterior"
            >
              <ArrowLeft className="h-4 w-4 mr-2"/>
              Voltar
            </Button>
            <div className="h-5 w-px bg-border"/>
            <div>
              <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-muted-foreground"/>
                Configurações
                <span className="text-muted-foreground font-normal">·</span>
                <span className="text-muted-foreground font-normal">{activeTabMeta.label}</span>
              </h1>
            </div>
          </div>
        </div>
      </div>

      {/* Content area com tabs laterais */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full max-w-[1920px] mx-auto flex">
          {/* Sidebar com tabs */}
          <div className="w-60 border-r bg-muted/30 py-4 px-3 flex-shrink-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
              Configurações
            </p>
            <nav role="tablist" aria-label="Seções de configurações" className="space-y-0.5">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                        'w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                        isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted'
                    )}
                  >
                    <Icon
                        className={cn('h-4 w-4 mt-0.5 flex-shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}/>
                    <div className="min-w-0">
                      <p className={cn('text-sm', isActive ? 'font-medium' : 'font-normal')}>
                        {tab.label}
                      </p>
                      <p className="text-xs text-muted-foreground leading-snug mt-0.5 truncate">
                        {tab.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-8">
              <div className="max-w-2xl">
                {renderTabContent()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
