/**
 * Página de Configurações do Usuário
 * Layout com tabs para Perfil, Segurança e Integrações
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { 
  User, 
  Shield, 
  Plug,
  ArrowLeft,
  Settings as SettingsIcon
} from 'lucide-react';
import { ProfileSection } from '@/components/user/ProfileSection';
import { SecuritySection } from '@/components/user/SecuritySection';
import { IntegrationsSection } from '@/components/user/IntegrationsSection';

type TabId = 'profile' | 'security' | 'integrations';

interface Tab {
  id: TabId;
  label: string;
  icon: any;
  description: string;
}

const TABS: Tab[] = [
  {
    id: 'profile',
    label: 'Perfil',
    icon: User,
    description: 'Informações pessoais e avatar'
  },
  {
    id: 'security',
    label: 'Segurança',
    icon: Shield,
    description: 'Senha e autenticação'
  },
  {
    id: 'integrations',
    label: 'Integrações',
    icon: Plug,
    description: 'Serviços externos e APIs'
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
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between max-w-[1920px] mx-auto">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
              <div className="h-6 w-px bg-border" />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                  <SettingsIcon className="h-6 w-6" />
                  Configurações
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {TABS.find(t => t.id === activeTab)?.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content area com tabs laterais */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full max-w-[1920px] mx-auto flex">
          {/* Sidebar com tabs */}
          <div className="w-64 border-r bg-muted/10 p-6">
            <nav className="space-y-1">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      isActive && 'bg-accent text-accent-foreground font-medium'
                    )}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-8">
              <div className="max-w-4xl">
                {renderTabContent()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

