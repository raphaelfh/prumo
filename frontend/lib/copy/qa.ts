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
};
