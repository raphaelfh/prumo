/**
 * Postiz-style client picker (spec §4.5): a chip row of AI clients, the
 * selected client's one-line instruction, and its config snippet with a
 * Copy button. Reused by the permanent "Connect an AI agent" card (the
 * placeholder token) and by the token reveal dialog (the real secret).
 */
import {useState} from 'react';

import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {CopyBlock} from '@/components/user/CopyBlock';
import {getApiBaseUrl} from '@/integrations/api/client';
import {buildClientSnippet, CLIENT_IDS, type ClientId} from '@/lib/mcp/clientSnippets';
import {t} from '@/lib/copy';
import type {personalAccessTokens} from '@/lib/copy/personalAccessTokens';

type CopyKey = keyof typeof personalAccessTokens;

const INSTRUCTION_KEY: Record<ClientId, CopyKey> = {
  'claude-code': 'instructionClaudeCode',
  cursor: 'instructionCursor',
  vscode: 'instructionVsCode',
  'gemini-cli': 'instructionGeminiCli',
  codex: 'instructionCodex',
  windsurf: 'instructionWindsurf',
};

const CHIP_KEY: Record<ClientId, CopyKey> = {
  'claude-code': 'chipClaudeCode',
  cursor: 'chipCursor',
  vscode: 'chipVsCode',
  'gemini-cli': 'chipGeminiCli',
  codex: 'chipCodex',
  windsurf: 'chipWindsurf',
};

export function McpClientSnippetSelector({token}: {token: string}) {
  const [client, setClient] = useState<ClientId>('claude-code');

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <ToggleGroup type="single" aria-label={t('personalAccessTokens', 'clientPickerAria')} value={client} onValueChange={(v) => v && setClient(v as ClientId)}>
          {CLIENT_IDS.map((id) => (
            <ToggleGroupItem key={id} value={id} className="shrink-0 whitespace-nowrap">
              {t('personalAccessTokens', CHIP_KEY[id])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <p className="text-[13px] text-muted-foreground">{t('personalAccessTokens', INSTRUCTION_KEY[client])}</p>
      <CopyBlock
        label={t('personalAccessTokens', CHIP_KEY[client])}
        code={buildClientSnippet(client, {url: `${getApiBaseUrl()}/mcp`, token})}
      />
    </div>
  );
}
