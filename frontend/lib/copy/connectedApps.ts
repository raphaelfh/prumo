/**
 * UI copy for Integrations → Connected apps: apps the user approved through
 * the OAuth consent page, with their access and a revoke. English only.
 */
export const connectedApps = {
    groupTitle: 'Connected apps',
    groupHint: 'Apps you allowed to use prumo for you. Revoking one ends its access right away.',
    listLoading: 'Loading connected apps…',
    listEmpty: 'No apps connected',
    listLoadError: "Couldn't load your connected apps.",
    retry: 'Retry',
    badgeRead: 'Read',
    badgeEdits: 'Edits',
    badgeAiRuns: 'AI runs',
    badgeRevoked: 'Revoked',
    badgeExpired: 'Expired',
    lastUsed: 'Last used {{when}}',
    neverUsed: 'Never used',
    revokeLabel: 'Revoke access',
    revokeTitle: 'Revoke this app?',
    revokeBody: '{{name}} loses access to your prumo account right away. To use it again, connect it again from the app.',
    revokeConfirm: 'Revoke',
    revokeCancel: 'Cancel',
    revokeFailed: "Couldn't revoke this app. Try again.",
    revoked: 'App revoked',
} as const;
