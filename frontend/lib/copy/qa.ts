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
    "Run `make db-seed` (or `python -m app.seed`) to install PROBAST, PROBAST+AI and QUADAS-2.",
  noArticlesTitle: 'No articles in this project yet',
  noArticlesDesc: 'Add an article first; quality assessment runs against an article + tool pair.',
  loadArticlesError: 'Failed to load articles for the quality-assessment view.',
  untitledArticle: 'Untitled article',
  noAuthors: 'Authors not provided',

  // QASectionAccordion — the per-domain judgment card
  domainJudgmentCardTitle: 'Domain judgment',

  // Computed overall judgments (worst-domain; never entered by a reviewer)
  overallBannerTitle: 'Overall judgments',
  overallBannerHint: 'Computed from the domain judgments (worst domain). Not editable.',
  overallIncomplete: '—',
  overallIncompleteHint: 'Incomplete — at least one domain has not been judged.',

  // "How is this calculated?" disclosure on the banner. A dash used to be
  // unexplained: with sixteen domain judgments across ten sections, a reviewer
  // could not tell which blank one was withholding the overall.
  overallExplainShow: 'How is this calculated?',
  overallExplainHide: 'Hide calculation',
  overallExplainRule:
    'Each overall takes the worst of the domain judgments that feed it: High beats Unclear, which beats Low. It is never entered by hand.',
  overallExplainIncomplete:
    'A dash means at least one contributing domain has not been judged yet — an unfinished assessment is never reported as low risk. Judge the domains marked “Not judged” below to complete it.',
  overallExplainNoInformation:
    '“No information” on a domain judgment counts as Unclear: on the Low / High / Unclear scale, “cannot determine from this article” is a judgment. Inside Evaluation D4 it means the study did not report that performance type, so it is left out instead — a study is not marked down for validation it never claimed to perform.',
  overallExplainInputNotJudged: 'Not judged',

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
  configEmptyGlobals:
    'No quality-assessment templates available. Seed PROBAST, PROBAST+AI and QUADAS-2 first.',
  configToggleEnable: 'Enable',
  configToggleDisable: 'Disable',
  configToggleEnabling: 'Enabling…',
  configToggleDisabling: 'Disabling…',

  // Manager review-visibility (per-kind blind toggle, shown in Configuration)
  managerVisibilitySectionTitle: 'Reviewer visibility',
  managerVisibilitySectionDesc:
    'Control whether managers see other reviewers’ assessments for this project.',

  // QualityAssessmentFullScreen — header, status, toasts
  badge: 'Quality Assessment',
  badgeShort: 'QA',
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
  // Run-header staged transition (extraction-parity: Mark ready / Start
  // consensus / Approve & finalize — kind-neutral labels reuse the
  // extraction namespace keys, these carry the QA-specific wording).
  runHeaderFinishAssessment: 'Finish assessment',
  runHeaderFinishAssessmentTooltip: 'Signal that you are done assessing this article.',
  runHeaderAssessmentFinished: 'Assessment finished',
  runHeaderApproveBlocked: 'Resolve every diverging question first',
  markReadySuccess: 'Assessment marked as ready.',

  // Active template bar
  activeTemplateLabel: 'Active tool:',
  activeTemplateNone:
    'No tool enabled — open Configuration to enable PROBAST, PROBAST+AI or QUADAS-2.',

  // Empty article-table state
  noArticlesForListTitle: 'No articles to assess',
  noArticlesForListDesc: 'Once articles are added to the project they appear here.',
};
