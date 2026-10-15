/** Keys for the signed-in user's own data (connections, providers, OAuth consent requests). */
export const meKeys = {
  all: ['me'] as const,
  connections: () => [...meKeys.all, 'connections'] as const,
  tokens: () => [...meKeys.all, 'tokens'] as const,
  providers: () => [...meKeys.all, 'providers'] as const,
  oauthRequest: (id: string) => [...meKeys.all, 'oauth-request', id] as const,
} as const;
