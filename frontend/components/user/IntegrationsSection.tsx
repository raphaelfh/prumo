/**
 * Settings → Integrations: one settings page whose body is the AI connections
 * group, the Zotero group, the personal access tokens group, and the
 * permanent "Connect an AI agent (MCP)" card (spec 2026-09-13 borderless
 * density pass § 4.3; spec §4.5). Each child returns its own SettingsGroup
 * as its root, so the body holds groups only and draws one hairline between
 * them — four groups now.
 */

import {SettingsPage} from '@/components/settings';
import {AiConnectionsSection} from '@/components/user/AiConnectionsSection';
import {ZoteroIntegrationSection} from '@/components/project/settings/ZoteroIntegrationSection';
import {PersonalAccessTokensGroup} from '@/components/user/PersonalAccessTokensGroup';
import {McpClientConfigCard} from '@/components/user/McpClientConfigCard';

export function IntegrationsSection() {
  return (
    <SettingsPage>
      <AiConnectionsSection/>
      <ZoteroIntegrationSection/>
      <PersonalAccessTokensGroup/>
      <McpClientConfigCard/>
    </SettingsPage>
  );
}
