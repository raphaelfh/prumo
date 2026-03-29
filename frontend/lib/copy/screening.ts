/**
 * UI copy for screening area. English only.
 */
export const screening = {
    // Tabs
    tabScreening: 'Screening',
    tabDashboard: 'Dashboard',
    tabConfiguration: 'Configuration',

    // Phase selector
    phaseTitleAbstract: 'Title / Abstract',
    phaseFullText: 'Full Text',

    // Card view
    allScreened: 'All articles have been screened!',
    allScreenedDesc: '{{n}} article(s) screened in {{phase}} phase.',
    pending: 'pending',
    include: 'Include',
    exclude: 'Exclude',
    maybe: 'Maybe',
    reasonPlaceholder: 'Reason for decision (optional)',

    // Keyboard shortcuts
    shortcutInclude: '1',
    shortcutExclude: '2',
    shortcutMaybe: '3',

    // Criteria
    criteriaTitle: 'Screening criteria',
    addInclusion: 'Inclusion',
    addExclusion: 'Exclusion',
    criterionLabelPlaceholder: 'Criterion label',
    criterionDescPlaceholder: 'Description (optional)',
    noCriteria: 'No criteria defined. Add inclusion or exclusion criteria to guide screening.',

    // Config
    reviewSettings: 'Review settings',
    dualReview: 'Dual review',
    dualReviewDesc: 'Require two independent reviewers per article',
    blindMode: 'Blind mode',
    blindModeDesc: "Hide other reviewers' decisions until both have screened",
    aiSettings: 'AI screening settings',
    aiModel: 'Model',
    aiInstruction: 'Custom system instruction (optional)',
    aiInstructionPlaceholder: 'Additional instructions for the AI screening model...',
    saveConfig: 'Save configuration',
    savingConfig: 'Saving...',
    configSaved: 'Configuration saved',
    configError: 'Error saving configuration',

    // Dashboard
    progressTitle: '{{phase}} Screening Progress',
    total: 'Total',
    screened: 'Screened',
    included: 'Included',
    excluded: 'Excluded',
    conflicts: 'Conflicts',

    // Inter-rater
    interRaterTitle: 'Inter-Rater Reliability',
    cohensKappa: "Cohen's Kappa",
    almostPerfect: 'Almost perfect agreement',
    substantial: 'Substantial agreement',
    moderate: 'Moderate agreement',
    fair: 'Fair agreement',
    slight: 'Slight agreement',

    // PRISMA
    prismaTitle: 'PRISMA 2020 Flow',
    identification: 'Identification',
    recordsIdentified: 'Records identified',
    duplicatesRemoved: 'Duplicates removed',
    recordsScreened: 'Records screened',
    recordsExcluded: 'Records excluded',
    eligibility: 'Eligibility',
    fullTextAssessed: 'Full-text assessed',
    fullTextExcluded: 'Full-text excluded',
    studiesIncluded: 'Studies included',

    // AI
    aiScreening: 'AI Screening',
    aiScreenBatch: 'AI screen all pending',
    aiScreening1: 'AI screening article...',
    aiScreeningBatch: 'AI screening {{n}} articles...',
    aiScreeningComplete: 'AI screening complete',
    aiScreeningError: 'AI screening error',

    // Decision feedback
    articleIncluded: 'Article included',
    articleExcluded: 'Article excluded',
    articleMaybe: 'Article marked as maybe',
    decisionError: 'Error submitting decision',
} as const;

export type ScreeningCopy = typeof screening;
