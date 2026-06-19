/**
 * Canonical, committed E2E fixture identities — the single source of truth.
 * Non-personal and deterministic so the suite self-provisions with zero
 * manual setup. User UUIDs are NOT pinned (Supabase generates them on
 * admin-create); only project/article IDs are fixed because tests reference
 * them directly via env. Passwords/keys here are LOCAL-ONLY test values.
 */
export const FIXTURE_PASSWORD = "E2eFixture!Pass123";

export const OWNER_EMAIL = "e2e-owner@prumo.test";
export const REVIEWER_B_EMAIL = "e2e-reviewer-b@prumo.test";
export const REVIEWER_C_EMAIL = "e2e-reviewer-c@prumo.test";

/** Main project the extraction/HITL/QA tests operate on (CHARMS imported). */
export const PROJECT_ID = "5b9d8976-6da5-45e4-84a5-380a40fdbb0b";
export const ARTICLE_ID = "f00dc63a-6b47-42c3-8a93-af69eb28a1c0";

/**
 * Dedicated articles for the two API suites that hard-reset QA runs
 * (`prepareCleanQaRun` → `resetQaRuns` deletes every quality_assessment run for
 * a (project, article) pair). They share the same project but MUST NOT share an
 * article, or running them in parallel lets one suite delete the other's
 * in-flight run mid-decision. One article per resetting suite = no collision.
 */
export const QA_CONSENSUS_ARTICLE_ID = "f00dc63a-6b47-42c3-8a93-af69eb28a1c1";
export const QA_BLIND_REVIEW_ARTICLE_ID = "f00dc63a-6b47-42c3-8a93-af69eb28a1c2";

/** Dedicated project for the template-import test — intentionally CHARMS-free. */
export const IMPORT_PROJECT_ID = "e2e00001-0000-4000-8000-000000000001";

/** Fixed global-catalogue ids (match backend/app/seed.py). */
export const CHARMS_GLOBAL_TEMPLATE_ID = "000c0000-0000-0000-0000-000000000001";
export const PROBAST_GLOBAL_TEMPLATE_ID = "00b00000-0000-0000-0000-000000000001";

/** Plausible study text so AI extraction has grounded input (LLM opt-in). */
export const FIXTURE_ARTICLE_BLOCKS = [
  "We developed a prognostic model to predict 30-day mortality in adults admitted with community-acquired pneumonia.",
  "A retrospective cohort of 1,240 patients from two tertiary hospitals was used for development; candidate predictors included age, sex, CRP, urea, and respiratory rate.",
  "The model was fitted with logistic regression; discrimination was assessed by the c-statistic and calibration by the calibration slope.",
];
