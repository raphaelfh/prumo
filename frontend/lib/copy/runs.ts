/**
 * UI copy for the shared runs/header library. English only.
 * These strings are consumed by the RunHeader slot components and are
 * namespace-agnostic — they must not reference the extraction namespace
 * so that QA and other consumers can adopt the same header library.
 */
export const runs = {
  // StageRail
  revision: 'Revision',
  stageProposal: 'Proposal',
  stageReview: 'Review',
  stageConsensus: 'Consensus',
  stageFinalized: 'Finalized',
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
  // Navigation (also kept in extraction for ExtractionHeader callers)
  articlePrevious: 'Previous article',
  articleNext: 'Next article',
} as const;

export type RunsCopy = typeof runs;
