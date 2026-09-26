/**
 * Settings → Integrations → "Connect an AI agent (MCP)" (spec §4.5, §4.7):
 * always visible, whether or not the researcher has created a token — the
 * chip selector always shows a ready-to-paste snippet, with the
 * placeholder token when none is real yet. Renders one SettingsGroup as its
 * root (borderless density pass § 4.3).
 */
import {ExternalLink} from 'lucide-react';

import {SettingsGroup} from '@/components/settings';
import {McpClientSnippetSelector} from '@/components/user/McpClientSnippetSelector';
import {TOKEN_PLACEHOLDER} from '@/lib/mcp/clientSnippets';
import {t} from '@/lib/copy';

export function McpClientConfigCard() {
  return (
    <SettingsGroup title={t('personalAccessTokens', 'connectTitle')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{t('personalAccessTokens', 'connectHint')}</p>
        <a
          href="https://github.com/raphaelfh/prumo/blob/dev/docs/how-to/connect-an-ai-agent.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 text-[12px] text-primary hover:underline"
        >
          {t('personalAccessTokens', 'docsLink')}<ExternalLink className="h-3 w-3" strokeWidth={1.5} />
        </a>
      </div>
      <McpClientSnippetSelector token={TOKEN_PLACEHOLDER} />
    </SettingsGroup>
  );
}
