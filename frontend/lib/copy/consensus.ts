/**
 * UI copy for the Project Settings → Review consensus section. English only.
 */
export const consensus = {
    // Tab + section
    tabConsensus: 'Review consensus',
    tabConsensusDesc: 'Reviewers, consensus rule, and arbitrator',
    sectionTitle: 'Review consensus',
    sectionDesc:
        'Configure how many reviewers an article needs and how disagreements are resolved.',
    runsBannerTitle: 'These settings only affect new Runs',
    runsBannerBody:
        'Runs already in progress keep the snapshot they were created with. Changes here apply to the next Run created for an article.',

    // Project default card
    projectDefaultTitle: 'Project default',
    projectDefaultDesc:
        'Used for any template that does not have its own override.',
    projectDefaultUsingSystem:
        'No project default set yet — using the system default (1 reviewer, unanimous).',
    saveProjectDefault: 'Save project default',
    resetProjectDefault: 'Reset to system default',

    // Templates list
    templatesTitle: 'Per-template overrides',
    templatesDesc:
        'Override the project default for a specific extraction template or QA tool.',
    templatesEmpty: 'No active templates yet — import one from the Configuration tab.',
    templatesLoading: 'Loading templates…',
    templatesInheritsBadge: 'Inherits from project',
    templatesOverriddenBadge: 'Overridden',
    templatesOverrideAction: 'Override',
    templatesEditAction: 'Edit override',
    templatesRemoveOverride: 'Remove override',

    // Form fields
    reviewerCountLabel: 'Reviewers per article',
    reviewerCountHint:
        'How many reviewers must submit decisions before consensus is evaluated.',
    ruleLabel: 'Consensus rule',
    ruleHint:
        'How the canonical value is chosen once enough reviewers have decided.',
    ruleUnanimous: 'Unanimous — every reviewer must agree',
    ruleMajority: 'Majority — most-voted decision wins',
    ruleArbitrator: 'Arbitrator — a designated user resolves disagreements',
    arbitratorLabel: 'Arbitrator',
    arbitratorHint:
        'A project member who breaks ties or sets the canonical value when reviewers disagree.',
    arbitratorPlaceholder: 'Select an arbitrator…',
    arbitratorRequired:
        'An arbitrator is required when the rule is "Arbitrator".',
    arbitratorNoEligibleMembers:
        'No eligible arbitrator yet. Assign the Consensus or Manager role to a team member first.',

    // Common actions
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',

    // Notifications
    saveSuccessProject: 'Project consensus default saved',
    saveSuccessTemplate: 'Template override saved',
    saveError: 'Could not save consensus configuration',
    resetSuccessProject: 'Project consensus default cleared',
    resetSuccessTemplate: 'Template override removed',
    resetError: 'Could not clear consensus configuration',
} as const;

export type ConsensusCopy = typeof consensus;
