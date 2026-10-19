/**
 * Keys for the signed-in user's own data. `connections` is the LLM provider
 * keys; `oauthConnections` is the apps approved through OAuth for MCP.
 */
export const meKeys = {
  all: ['me'] as const,
  connections: () => [...meKeys.all, 'connections'] as const,
  tokens: () => [...meKeys.all, 'tokens'] as const,
  providers: () => [...meKeys.all, 'providers'] as const,
  oauthRequest: (id: string) => [...meKeys.all, 'oauth-request', id] as const,
  oauthConnections: () => [...meKeys.all, 'oauth-connections'] as const,
} as const;
