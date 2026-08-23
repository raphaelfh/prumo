/**
 * UI copy for shared components (comparison, AI suggestions). English only.
 */
export const shared = {
    // EntitySelectorComparison
    entity: 'entity',
    entities: 'entities',
    available: 'available',
    user: 'user',
    users: 'users',
    reviewer: 'reviewer',
    reviewers: 'reviewers',
    // ConsensusIndicator
    divergence: 'Divergence',
    // ComparisonCell
    usersCountTitle: '{{count}} of {{total}} users',
    valueEqualAria: 'Same value',
    // AISuggestionActions
    suggestionAccepted: 'Suggestion accepted',
    acceptSuggestion: 'Accept suggestion',
    suggestionRejected: 'Suggestion rejected',
    rejectSuggestion: 'Reject suggestion',
    // Comparison empty states
    selectEntityToCompare: 'Select a {{entity}} to compare across users',
    selectEntityPlaceholder: 'Select a {{entity}}',
    youHaveNoInstancesOf: "You haven't created any {{entity}} instances yet.",
    noEntityFoundForComparison: 'No entities found for comparison.',
    noFieldsToCompare: 'No fields to compare',
    required: 'Required',
    summary: 'Summary:',
    consensus: 'consensus',
    agreement: 'agreement',
    fieldLabel: 'Field',
    youLabel: 'You',
    consensusColumn: 'Consensus',
    // RunReviewerComparison (shared extraction + QA side-by-side compare)
    compareNoPeers: 'No other reviewers to compare yet.',
    compareNoPeersDesc:
        'Other reviewers’ values appear here once they record decisions (and, for managers, once reviewer visibility is on).',
    compareRejected: 'Rejected',
    compareNoValue: '—',
} as const;

