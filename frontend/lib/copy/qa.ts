/**
 * Copy namespace for the Quality Assessment area.
 *
 * Kept separate from `extraction` even though both share the
 * extraction-centric HITL stack — semantics on screen differ enough
 * (PROBAST/QUADAS-2 vocabulary, no "AI extraction" concept) that
 * mixing them in one namespace bloated reuse without clarity.
 */
export const qa = {
  // QualityAssessmentInterface (project landing)
  interfaceTitle: 'Quality assessment',
  interfaceDesc:
    'Select a tool and an article to start (or resume) a structured quality-assessment session.',
  noTemplatesTitle: 'No quality-assessment templates seeded',
  noTemplatesDesc:
    "Run `make db-seed` (or `python -m app.seed`) to install PROBAST and QUADAS-2.",
  noArticlesTitle: 'No articles in this project yet',
  noArticlesDesc: 'Add an article first; quality assessment runs against an article + tool pair.',
  loadArticlesError: 'Failed to load articles for the quality-assessment view.',
  untitledArticle: 'Untitled article',
  noAuthors: 'Authors not provided',

  // Tabs
  tabAssessment: 'Assessment',
  tabDashboard: 'Dashboard',
  tabConfiguration: 'Configuration',

  // Tab descriptions
  assessmentDesc: 'Run risk-of-bias assessments article by article',
  dashboardDesc: 'Project-level quality-assessment progress',
  configurationDesc: 'Choose which quality-assessment tools the project runs',

  // Configuration tab
  configHeader: 'Quality-assessment tools',
  configCountFormat: '{{enabled}}/{{total}} enabled',
  configEmptyGlobals: 'No quality-assessment templates available. Seed PROBAST + QUADAS-2 first.',
  configToggleEnable: 'Enable',
  configToggleDisable: 'Disable',
  configToggleEnabling: 'Enabling…',
  configToggleDisabling: 'Disabling…',

  // Manager review-visibility (per-kind blind toggle, shown in Configuration)
  managerVisibilitySectionTitle: 'Reviewer visibility',
  managerVisibilitySectionDesc:
    'Control whether managers see other reviewers’ assessments for this project.',

  // Assess vs. compare view toggle (assessment screen header)
  compareToggle: 'Comparison',
  assessToggle: 'Assessment',

  // QualityAssessmentFullScreen — header, status, toasts
  badge: 'Quality Assessment',
  loadingTemplate: 'Loading template…',
  missingRouteParams: 'Missing route parameters.',
  templateNotFound:
    'Quality-Assessment template {{templateId}} not found. The link may be stale — pick a template from the list and try again.',
  reopenButton: 'Reopen for revision',
  reopenProgress: 'Reopening…',
  publishedState: 'Published',
  finalizationSuccess: 'Assessment finalized.',
  reopenSuccess: 'Assessment reopened for revision.',
  reopenError: 'Failed to reopen assessment',
  publishSuccess: 'Assessment published.',
  publishError: 'Failed to publish assessment',
  publishEmptyError: 'Fill at least one signaling question before publishing.',

  // Active template bar
  activeTemplateLabel: 'Active tool:',
  activeTemplateNone: 'No tool enabled — open Configuration to enable PROBAST or QUADAS-2.',

  // Empty article-table state
  noArticlesForListTitle: 'No articles to assess',
  noArticlesForListDesc: 'Once articles are added to the project they appear here.',
};
