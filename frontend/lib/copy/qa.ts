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

  // Active template bar
  activeTemplateLabel: 'Active tool:',
  activeTemplateNone: 'No tool enabled — open Configuration to enable PROBAST or QUADAS-2.',

  // Empty article-table state
  noArticlesForListTitle: 'No articles to assess',
  noArticlesForListDesc: 'Once articles are added to the project they appear here.',
};
