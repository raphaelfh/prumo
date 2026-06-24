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
    runsBannerTitle: 'These settings only affect articles started from now on',
    runsBannerBody:
        'Articles already in progress keep the settings they started with. Changes here apply the next time an article is opened for extraction or assessment.',

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

    // Manager review visibility (per-kind blind toggle)
    managerVisibilityCardTitle: 'Manager review visibility',
    managerVisibilityCardDesc:
        'Control whether managers see other reviewers while extracting. Reviewers are always blind to each other.',
    managerVisibilityLabel: "Show other reviewers' responses to managers",
    managerVisibilityHint:
        'When off, managers review blind — they only see their own values until they turn this on. Reviewers are always blind to each other.',
    managerVisibilitySaved: 'Reviewer visibility updated.',
    managerVisibilityError: 'Could not update reviewer visibility.',
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

    // --- Runtime divergence-resolution panel (ConsensusPanel) ---
    panelResolveTitle: 'Resolve divergence',
    sectionConflictsTitle: 'Conflicts',
    sectionConflictsDesc: 'Reviewers gave different values. Resolve each.',
    sectionAttentionTitle: 'Needs attention',
    sectionAttentionDesc: 'Single-reviewer answers and unfilled required fields.',
    sectionAgreedHintOne: '1 field agreed — published automatically on finalize.',
    sectionAgreedHintOther: '{{count}} fields agreed — published automatically on finalize.',
    badgeRequiredGap: 'Required · not filled',
    badgeSingleFiller: 'Only one reviewer',
    nothingToReconcile: 'Nothing to reconcile. Use “Approve & finalize” in the header.',
    panelFieldsResolvedOne: '{{resolved}}/{{total}} field resolved.',
    panelFieldsResolvedOther: '{{resolved}}/{{total}} fields resolved.',
    panelFinalize: 'Finalize',
    panelFinalizing: 'Finalizing…',
    panelReviewerDisagreedOne: '{{count}} reviewer disagreed.',
    panelReviewersDisagreedOther: '{{count}} reviewers disagreed.',
    panelResolved: 'Resolved',
    panelRejected: '(rejected)',
    panelUseThisValue: 'Use this value',
    panelOverrideWithCustom: 'Override with custom value',
    panelCustomValueLabel: 'Custom value (JSON; use a string for free-text fields)',
    panelCustomValuePlaceholder: '"Low" or {"text": "..."}',
    panelRationaleLabel: 'Rationale (required)',
    panelRationalePlaceholder:
        'Why publish a value none of the reviewers picked?',
    panelPublishOverride: 'Publish override',
    panelReviewerFallback: 'Reviewer {{id}}…',

    // Resolved-state summary (Task 5)
    resolvedValueLabel: 'Published value',
    resolvedFromReviewer: 'from {{reviewer}}',
    resolvedCustom: 'custom value',
    resolvedRationaleLabel: 'Rationale',
    change: 'Change',
} as const;

export type ConsensusCopy = typeof consensus;
