/** Keys for the signed-in user's own data (connections, providers). */
export const meKeys = {
  all: ['me'] as const,
  connections: () => [...meKeys.all, 'connections'] as const,
  providers: () => [...meKeys.all, 'providers'] as const,
} as const;
