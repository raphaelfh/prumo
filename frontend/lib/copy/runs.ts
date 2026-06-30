/**
 * UI copy for the shared runs/header library. English only.
 * These strings are consumed by the RunHeader slot components and are
 * namespace-agnostic — they must not reference the extraction namespace
 * so that QA and other consumers can adopt the same header library.
 */
export const runs = {
  // StageRail (3 user-facing nodes: Extract → Consensus → Finalized).
  revision: 'Revision',
  stageExtract: 'Extract',
  stageConsensus: 'Consensus',
  stageFinalized: 'Finalized',
  stageExtractTooltip: 'Fill the form and review AI suggestions for this article.',
  stageConsensusTooltip: 'Reconcile reviewer values into one agreed answer.',
  stageFinalizedTooltip: 'Locked and published — reopen to make changes.',
  // StageRail per-node STATE, appended to each node's accessible name so the
  // state a sighted user reads from the icon is also announced to assistive tech.
  stageStateDone: 'completed',
  stageStateCurrent: 'current step',
  stageStateUpcoming: 'upcoming',
  stageStateLocked: 'locked',
  stageStateCancelled: 'cancelled',
  // PrimaryAction
  requiredOfTotal: '{{done}} of {{total}} required',
  // Transition label (QA's buildQaTransition uses this shared key)
  finalize: 'Finalize',
  gateBlocked: 'Complete the required fields first',
  // Reviewers
  reviewersDiffer: '{{count}} differ',
  reviewersReadyHint: '{{ready}}/{{total}} ready',
  reviewersOfExpected: '{{count}} of {{required}} reviewers',
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
  worklistPositionLabel: 'Article {{n}} of {{m}}, open list',
  aiPendingSuggestions: '{{n}} AI suggestions pending',
  compareToggleLabel: 'Compare',
  // CommandPalette
  commandPlaceholder: 'Type a command or search…',
  commandEmpty: 'No results',
  commandActions: 'Actions',
  commandGoToArticle: 'Go to article…',
  keyboardShortcuts: 'Keyboard shortcuts',
  commandPaletteOpen: 'Open command palette',
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
  glossaryExtract: 'Extract — fill the form and review AI suggestions.',
  glossaryConsensus: 'Consensus — reconcile diverging reviewer values.',
  glossaryFinalize: 'Finalize — lock and publish the agreed values.',
  glossaryBlind: 'Blind — you cannot see other reviewers’ values.',
  glossaryDiffer: '"N differ" — fields where reviewers disagree.',
} as const;

export type RunsCopy = typeof runs;
