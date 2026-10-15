/**
 * UI copy for the OAuth consent page (`/oauth/consent`): an app asks to
 * connect to the user's prumo account. English only.
 */
export const oauthConsent = {
    pageTitle: 'Connect an app to prumo',
    loading: 'Loading the request…',
    clientLabel: 'App',
    returnsTo: 'Returns you to',
    accessAll: 'Access to every prumo project you belong to; your project role still applies.',
    readItem: 'Read your projects',
    editLabel: 'Edit project setup',
    editHint: 'Manager-only; nothing goes live until a manager publishes.',
    allow: 'Allow',
    deny: 'Deny',
    submitting: 'Sending your answer…',
    returning: 'Returning to the app…',
    expiredTitle: 'Request expired',
    expiredBody: 'This request expired. Start again from Claude.',
    decidedTitle: 'Request already answered',
    decidedBody: 'This request was already answered. You can close this tab.',
    loadError: "Couldn't load this request.",
    submitError: "Couldn't send your answer.",
    rateLimited: 'Too many attempts. Wait a minute and try again.',
    retry: 'Retry',
    framedBody: "For your safety, this page can't be used inside another site. Open it in its own tab.",
} as const;
