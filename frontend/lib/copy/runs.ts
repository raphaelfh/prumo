/**
 * UI copy for the shared runs/header library. English only.
 * These strings are consumed by the RunHeader slot components and are
 * namespace-agnostic — they must not reference the extraction namespace
 * so that QA and other consumers can adopt the same header library.
 */
export const runs = {
  // Stage vocabulary (RunStatus chip + status-popover timeline).
  revision: 'Revision',
  stageExtract: 'Extraction',
  stageAssessment: 'Assessment',
  stageConsensus: 'Consensus',
  stageFinalized: 'Finalized',
  stagePending: 'Pending',
  stageCancelled: 'Cancelled',
  // Timeline per-node STATE, appended to each node's accessible name so the
  // state a sighted user reads from the icon is also announced to assistive tech.
  stageStateDone: 'completed',
  stageStateCurrent: 'current step',
  stageStateUpcoming: 'upcoming',
  stageStateLocked: 'locked',
  stageStateCancelled: 'cancelled',
  // Status-popover timeline explainers — two voices (reviewer vs arbitrator).
  stageExplainExtract: 'Fill in your answers independently; other reviewers stay hidden.',
  stageExplainExtractArbiter: 'Reviewers work independently; start consensus when they are ready.',
  stageExplainConsensus: 'The manager reconciles differences and approves.',
  stageExplainConsensusArbiter: 'Resolve divergences, then approve and publish.',
  stageExplainFinalized: 'Published values, read-only — reopen to edit.',
  // RunStatus chip + popover chrome
  runStatusLabel: 'Run status',
  runStatusChipLabel: 'Run status: {{stage}}',
  statusRequiredFields: '{{done}} of {{total}} required fields',
  statusViewDivergence: 'View',
  statusYouReviewAs: 'You review as {{role}}',
  statusRevisionNote: 'This run is a revision of a published version.',
  // PrimaryAction
  requiredOfTotal: '{{done}} of {{total}} required',
  // Transition label (QA's buildQaTransition uses this shared key)
  finalize: 'Finalize',
  // Reviewers
  reviewersDiffer: '{{count}} differ',
  reviewersReadyHint: '{{ready}}/{{total}} ready',
  reviewersOfExpected: '{{count}} of {{required}} reviewers',
  // Status popover (role / blind reveal)
  blindSuffix: 'blind',
  revealedSuffix: 'revealed',
  reveal: 'Reveal reviewers',
  blindExplainer: "You're blind to reviewers' values for this kind.",
  // PanelToggle
  togglePanel: 'Toggle source panel',
  // SaveSlot
  saved: 'Saved',
  saving: 'Saving…',
  saveFailed: 'Save failed',
  // Menu
  more: 'More options',
  // AIActions (single menu button)
  extractWithAI: 'Extract with AI',
  extractingWithAI: 'Extracting with AI…',
  aiActionsLabel: 'AI actions',
  reviewPendingSuggestions: 'Review {{n}} pending suggestions',
  // Navigation
  articlePrevious: 'Previous article',
  articleNext: 'Next article',
  // Worklist popover
  worklistSearch: 'Go to article…',
  worklistPosition: '{{n}} of {{m}}',
  worklistPositionLabel: 'Article {{n}} of {{m}}',
  aiPendingSuggestions: '{{n}} AI suggestions pending',
  compareToggleLabel: 'Compare',
  // CommandPalette
  commandPlaceholder: 'Type a command or search…',
  commandEmpty: 'No results',
  commandActions: 'Actions',
  commandGoToArticle: 'Go to article…',
  keyboardShortcuts: 'Keyboard shortcuts',
  commandPaletteOpen: 'Open command palette',
  viewRunStatus: 'View run status',
  // SidebarToggle (left, mirrors PanelToggle)
  sidebarToggle: 'Toggle navigation',
  // Phone focus-mode hamburger — opens the project navigation drawer.
  openProjectNav: 'Open project navigation',
  // Help panel ("?" button)
  helpButton: 'Help and shortcuts',
  helpTitle: 'Help',
  shortcutsHeading: 'Keyboard shortcuts',
  glossaryHeading: 'Workflow',
  shortcutPalette: 'Command palette',
  shortcutNextPrev: 'Next / previous article',
  shortcutTogglePdf: 'Toggle source panel',
  shortcutSidebar: 'Toggle navigation',
  shortcutEsc: 'Close dialogs',
  glossaryExtract: 'Extraction — fill the form and review AI suggestions.',
  glossaryAssessment: 'Assessment — answer the signaling questions and review AI suggestions.',
  glossaryConsensus: 'Consensus — reconcile diverging reviewer values.',
  glossaryFinalize: 'Finalize — lock and publish the agreed values.',
  glossaryBlind: 'Blind — you cannot see other reviewers’ values.',
  glossaryDiffer: '"N differ" — fields where reviewers disagree.',

  // Published / read-only state (shared HITLStatusBadges + sub-header banner)
  published: 'Published',
  publishedReadOnlyNotice: 'Published values — read-only. Reopen to edit.',
  reopenForRevision: 'Reopen for revision',
  reopening: 'Reopening…',
  revisionDerivedFrom: 'Derived from a previous version',
} as const;

export type RunsCopy = typeof runs;
