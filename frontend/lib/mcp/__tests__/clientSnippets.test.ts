import {describe, expect, it} from 'vitest';

import {buildClientSnippet, TOKEN_PLACEHOLDER} from '@/lib/mcp/clientSnippets';

const params = {url: 'https://api.test/mcp', token: 'prumo_pat_SECRET'};

describe('buildClientSnippet', () => {
  it('claude-code: a CLI command with a Bearer header', () => {
    expect(buildClientSnippet('claude-code', params)).toBe(
      'claude mcp add --transport http prumo https://api.test/mcp --header "Authorization: Bearer prumo_pat_SECRET"',
    );
  });

  it('cursor: mcpServers.prumo with url and headers', () => {
    expect(JSON.parse(buildClientSnippet('cursor', params))).toEqual({
      mcpServers: {prumo: {url: 'https://api.test/mcp', headers: {Authorization: 'Bearer prumo_pat_SECRET'}}},
    });
  });

  it('vscode: servers.prumo with type http', () => {
    expect(JSON.parse(buildClientSnippet('vscode', params))).toEqual({
      servers: {prumo: {type: 'http', url: 'https://api.test/mcp', headers: {Authorization: 'Bearer prumo_pat_SECRET'}}},
    });
  });

  it('gemini-cli: mcpServers.prumo with httpUrl', () => {
    expect(JSON.parse(buildClientSnippet('gemini-cli', params))).toEqual({
      mcpServers: {prumo: {httpUrl: 'https://api.test/mcp', headers: {Authorization: 'Bearer prumo_pat_SECRET'}}},
    });
  });

  it('codex: TOML with an [mcp_servers.prumo] table and http_headers', () => {
    const result = buildClientSnippet('codex', params);
    expect(result).toContain('[mcp_servers.prumo]');
    expect(result).toContain('url = "https://api.test/mcp"');
    expect(result).toContain('[mcp_servers.prumo.http_headers]');
    expect(result).toContain('Authorization = "Bearer prumo_pat_SECRET"');
  });

  it('windsurf: mcpServers.prumo with serverUrl', () => {
    expect(JSON.parse(buildClientSnippet('windsurf', params))).toEqual({
      mcpServers: {prumo: {serverUrl: 'https://api.test/mcp', headers: {Authorization: 'Bearer prumo_pat_SECRET'}}},
    });
  });

  it('exposes the placeholder token used in the permanent card', () => {
    expect(TOKEN_PLACEHOLDER).toBe('<YOUR_PRUMO_TOKEN>');
  });
});
