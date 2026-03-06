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
    noOtherReviewersCreatedModels: 'No other reviewer has created models yet.',
    noOtherReviewersCreatedModelsDesc: 'Comparison will be available when other members add models.',
    yourModel: 'Your model',
    selectYourModel: 'Select your model',
    compareWith: 'Compare with',
    modelsCreatedCount: '{{n}} model(s) created',
    noInstanceForSection: 'No instance created for this section',
    youHaveNoModels: "You haven't created any prediction models yet.",
    youHaveNoModelsDesc: 'Add models in the Extraction tab to compare.',
    selectOtherReviewer: 'Select other reviewer',
    selectModel: 'Select model',
    selectModelAbove: 'Select a model above',
    modelFallbackLabel: 'Model {{n}}',
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
} as const;

export type SharedCopy = typeof shared;
