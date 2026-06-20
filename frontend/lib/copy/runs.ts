/**
 * UI copy for the shared runs/header library. English only.
 * These strings are consumed by the RunHeader slot components and are
 * namespace-agnostic — they must not reference the extraction namespace
 * so that QA and other consumers can adopt the same header library.
 */
export const runs = {
  // StageRail (3 user-facing nodes: Extract → Consensus → Finalized).
  // stageProposal/stageReview linger until StageRail stops referencing them.
  revision: 'Revision',
  stageExtract: 'Extract',
  stageProposal: 'Proposal',
  stageReview: 'Review',
  stageConsensus: 'Consensus',
  stageFinalized: 'Finalized',
  stageExtractTooltip: 'Fill the form and review AI suggestions for this article.',
  stageConsensusTooltip: 'Reconcile reviewer values into one agreed answer.',
  stageFinalizedTooltip: 'Locked and published — reopen to make changes.',
  gateRemaining: '{{count}} left',
  // PrimaryAction
  requiredOfTotal: '{{done}} of {{total}} required',
  // Transition labels (also kept in extraction for stageTransition.ts callers)
  submitForReview: 'Submit for review',
  reconcile: 'Reconcile',
  finalize: 'Finalize',
  gateBlocked: 'Complete the required fields first',
  // Reviewers
  reviewersDiffer: '{{count}} differ',
  // RoleChip
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
  // AIActions
  extractWithAI: 'Extract with AI',
  extractingWithAI: 'Extracting with AI…',
  // Navigation
  articlePrevious: 'Previous article',
  articleNext: 'Next article',
  // Worklist popover
  worklistSearch: 'Go to article…',
  worklistPosition: '{{n}} of {{m}}',
  // CommandPalette
  commandPlaceholder: 'Type a command or search…',
  commandEmpty: 'No results',
  commandActions: 'Actions',
  commandGoToArticle: 'Go to article…',
  keyboardShortcuts: 'Keyboard shortcuts',
  commandPaletteOpen: 'Open command palette',
  // SidebarToggle (left, mirrors PanelToggle)
  sidebarToggle: 'Toggle navigation',
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
  glossaryExtract: 'Extract — fill the form and review AI suggestions.',
  glossaryConsensus: 'Consensus — reconcile diverging reviewer values.',
  glossaryFinalize: 'Finalize — lock and publish the agreed values.',
  glossaryBlind: 'Blind — you cannot see other reviewers’ values.',
  glossaryDiffer: '"N differ" — fields where reviewers disagree.',
} as const;

export type RunsCopy = typeof runs;
