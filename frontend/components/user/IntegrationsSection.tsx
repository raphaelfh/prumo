/**
 * Integrations section: AI connections and Zotero.
 */

import {SettingsSection} from '@/components/settings';
import {AiConnectionsSection} from '@/components/user/AiConnectionsSection';
import {ZoteroIntegrationSection} from '@/components/project/settings/ZoteroIntegrationSection';
import {t} from '@/lib/copy';

export function IntegrationsSection() {
  return (
      <div className="space-y-8">
          <SettingsSection
              title={t('llmConnections', 'integrationsTitle')}
              description={t('llmConnections', 'integrationsDescription')}
          >
              <AiConnectionsSection/>
          </SettingsSection>
          <SettingsSection
              title={t('user', 'integrationsZoteroTitle')}
              description={t('user', 'integrationsZoteroDescription')}
          >
              <ZoteroIntegrationSection/>
          </SettingsSection>
    </div>
  );
}

