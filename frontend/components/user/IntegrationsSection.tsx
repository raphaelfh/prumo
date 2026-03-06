/**
 * Integrations section: API keys and Zotero.
 */

import {SettingsSection} from '@/components/settings';
import {ApiKeysSection} from '@/components/user/ApiKeysSection';
import {ZoteroIntegrationSection} from '@/components/project/settings/ZoteroIntegrationSection';
import {t} from '@/lib/copy';

export function IntegrationsSection() {
  return (
      <div className="space-y-8">
          <SettingsSection
              title={t('user', 'integrationsApiKeysTitle')}
              description={t('user', 'integrationsApiKeysDescription')}
          >
              <ApiKeysSection/>
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

