/**
 * Per-client MCP config snippet builder (spec §4.5): pure string formatting
 * from `{url, token}`, no backend I/O — exempt from the
 * component→hook→service→apiClient data path like any other `frontend/lib/*`
 * pure helper.
 */

export type ClientId = 'claude-code' | 'claude-ai' | 'cursor' | 'vscode' | 'gemini-cli' | 'codex' | 'windsurf';

export const CLIENT_IDS: readonly ClientId[] = ['claude-code', 'claude-ai', 'cursor', 'vscode', 'gemini-cli', 'codex', 'windsurf'] as const;

/** Clients that send a personal access token; claude.ai connects through OAuth instead (ADR 0022). */
export const TOKEN_CLIENT_IDS: readonly ClientId[] = CLIENT_IDS.filter((id) => id !== 'claude-ai');

/** Shown in the permanent card, where there is no real secret yet. */
export const TOKEN_PLACEHOLDER = '<YOUR_PRUMO_TOKEN>';

/** One config snippet per client, verified against each vendor's current docs (spec §4.5). Not translated: syntax is language-independent. */
export function buildClientSnippet(client: ClientId, {url, token}: {url: string; token: string}): string {
  const headers = {Authorization: `Bearer ${token}`};
  switch (client) {
    case 'claude-code':
      return `claude mcp add --transport http prumo ${url} --header "Authorization: Bearer ${token}"`;
    case 'claude-ai':
      return url;
    case 'cursor':
      return JSON.stringify({mcpServers: {prumo: {url, headers}}}, null, 2);
    case 'vscode':
      return JSON.stringify({servers: {prumo: {type: 'http', url, headers}}}, null, 2);
    case 'gemini-cli':
      return JSON.stringify({mcpServers: {prumo: {httpUrl: url, headers}}}, null, 2);
    case 'codex':
      return `[mcp_servers.prumo]\nurl = "${url}"\n\n[mcp_servers.prumo.http_headers]\nAuthorization = "Bearer ${token}"`;
    case 'windsurf':
      return JSON.stringify({mcpServers: {prumo: {serverUrl: url, headers}}}, null, 2);
  }
}
