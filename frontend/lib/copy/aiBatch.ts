/** Copy for AI batch runs (spec 2026-09-15 §10–§11). */
export const aiBatch = {
  // Selection bar
  selectedCount: '{{n}} selected',
  runAI: 'Run AI',
  clearSelection: 'Clear',
  tooManySelected: 'Up to 100 articles per run',
  batchRunningChip: 'AI running · {{done}}/{{total}}',
  view: 'View',

  // Confirm dialog
  confirmTitle: 'Run AI on {{n}} articles?',
  confirmTitleOne: 'Run AI on 1 article?',
  confirmEngineLine: 'Model: {{engine}}',
  confirmKeepsHumanAnswers: 'Answers a person already gave are kept.',
  confirmSkipLabel: 'Skip articles that already have AI suggestions',
  confirmCancel: 'Cancel',
  confirmRun: 'Run AI',
  startedToast: 'AI started for {{n}} articles',
  startedToastOne: 'AI started for 1 article',

  // Start errors (§10 F1/F3/F4)
  startEngineProblemTitle: 'AI is not configured',
  startEngineAction: 'Choose engine',
  startQueueDownTitle: 'The AI queue is unavailable',
  startQueueDownDescription: 'Nothing was queued. Please try again.',
  startAlreadyActiveTitle: 'An AI batch is already running for this tool',
  startFailedTitle: 'Could not start the AI batch',

  // Bell item
  bellTitleExtraction: 'AI extraction · {{template}}',
  bellTitleAssessment: 'AI assessment · {{template}}',
  bellProgress: '{{done}}/{{total}}',
  bellCancel: 'Cancel',
  bellDetails: 'Details',
  bellFinished: '{{done}} done',
  bellNeedsAttention: '{{n}} need attention',
  bellNeedsAttentionOne: '1 needs attention',
  bellStoppedEngine: 'Stopped: engine problem',
  bellCancelled: 'Cancelled: {{done}} done, {{notRun}} not run',
  bellStalled: 'No progress for 15 minutes',

  // Details sheet
  sheetTitle: 'AI batch',
  sheetGroupNeedsAttention: 'Needs attention',
  sheetGroupSkipped: 'Skipped',
  sheetGroupNotRun: 'Not run',
  sheetGroupDone: 'Done',
  sheetOpenArticle: 'Open article',
  sheetCancel: 'Cancel batch',
  sheetResume: 'Resume',
  sheetRetryFailed: 'Retry failed',
  sheetRunRemaining: 'Run remaining',
  sheetUntitled: 'Untitled article',

  // Per-article reasons (§10)
  reasonRunFinalized: 'Finalized — reopen it to run AI',
  reasonRunNotEditable: 'Not editable right now',
  reasonAlreadyHasAiSuggestions: 'Already has AI suggestions',
  reasonAiAlreadyRunning: 'AI is already running on it',
  reasonNoLongerAvailable: 'The tool, article or run is no longer available',
  reasonCancelled: 'Not run',
  reasonStoppedEngineError: 'Not run — the batch stopped',
  reasonPdfNotFound: 'No PDF',
  reasonExtractionFailed: 'Extraction failed',
  reasonSectionsFailed: '{{failed}} of {{total}} sections failed',
  reasonUnknown: 'Unavailable',

  // Row status
  rowQueued: 'Queued for AI',
  rowRunning: 'AI is running',
} as const;
